import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";
import { formatContextPack } from "../contextpack.js";
import type { AgentRoomEvent, Assignment, RunnerProbe, RunnerType, SeatStateFile } from "../types.js";
import { appendEvent, appendTranscript, writeSeatState } from "../storage.js";

export type RunnerRunContext = {
  projectRoot: string;
  cwd: string;
  timeoutMs: number;
};

export type RunnerCommand = {
  command: string;
  args: string[];
  stdin?: string;
};

export interface RunnerAdapter {
  type: RunnerType;
  displayName: string;
  promptCommand(prompt: string): RunnerCommand;
  probe(projectRoot?: string): Promise<RunnerProbe>;
  run(assignment: Assignment, ctx: RunnerRunContext): AsyncIterable<AgentRoomEvent>;
  stop(instanceId: string): Promise<void>;
}

const running = new Map<string, ChildProcessWithoutNullStreams>();
const stopRequested = new Set<string>();

export abstract class ProcessRunnerAdapter implements RunnerAdapter {
  abstract type: RunnerType;
  abstract displayName: string;
  abstract versionCommand(): RunnerCommand;
  abstract promptCommand(prompt: string): RunnerCommand;

  async probe(): Promise<RunnerProbe> {
    const started = Date.now();
    const version = await runCapture(this.versionCommand(), process.cwd(), 15_000);
    return {
      type: this.type,
      available: version.exitCode === 0,
      command: this.versionCommand().command,
      version: version.stdout.trim() || version.stderr.trim() || undefined,
      versionExitCode: version.exitCode,
      stderr: version.stderr,
      error: version.error,
      durationMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    };
  }

  async *run(assignment: Assignment, ctx: RunnerRunContext): AsyncIterable<AgentRoomEvent> {
    const now = new Date().toISOString();
    const baseState: SeatStateFile = {
      seatId: assignment.targetSeatId,
      runnerType: this.type,
      state: "running",
      currentTask: assignment.instruction,
      startedAt: now,
      updatedAt: now,
    };
    await writeSeatState(assignment.sessionId, baseState, ctx.projectRoot);
    yield await emit(assignment.sessionId, { type: "assignment.started", assignmentId: assignment.id, seatId: assignment.targetSeatId, ts: now }, ctx.projectRoot);
    yield await emit(assignment.sessionId, { type: "seat.state_changed", seatId: assignment.targetSeatId, state: "running", ts: now }, ctx.projectRoot);

    const prompt = assignmentPrompt(assignment);
    const command = this.promptCommand(prompt);
    const child = spawn(command.command, command.args, {
      cwd: ctx.cwd,
      shell: needsShell(command.command),
      windowsHide: true,
      env: {
        ...process.env,
        AGENTROOM_RUNNER_PROMPT: prompt,
      },
    });
    if (command.stdin !== undefined) {
      child.stdin.end(command.stdin);
    }
    running.set(assignment.targetSeatId, child);
    await writeSeatState(
      assignment.sessionId,
      {
        ...baseState,
        processId: child.pid,
        updatedAt: new Date().toISOString(),
      },
      ctx.projectRoot,
    );

    const timeout = setTimeout(() => {
      killProcessTree(child.pid);
    }, ctx.timeoutMs);

    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      void appendTranscript(assignment.sessionId, assignment.targetSeatId, text, ctx.projectRoot);
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        void emit(assignment.sessionId, { type: "activity.appended", seatId: assignment.targetSeatId, text: line, ts: new Date().toISOString() }, ctx.projectRoot);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      void appendTranscript(assignment.sessionId, assignment.targetSeatId, text, ctx.projectRoot);
    });

    const result = await waitForExit(child);
    clearTimeout(timeout);
    running.delete(assignment.targetSeatId);

    const finishedAt = new Date().toISOString();
    const timedOut = result.signal !== null && result.exitCode === null;
    const stopped = stopRequested.delete(assignment.targetSeatId);
    const ok = result.exitCode === 0 && !timedOut;
    await writeSeatState(
      assignment.sessionId,
      {
        ...baseState,
        state: stopped ? "stopped" : ok ? "done" : "failed",
        finishedAt,
        error: stopped ? undefined : ok ? undefined : stderr || `进程退出码异常：${result.exitCode ?? "未知"}`,
        updatedAt: finishedAt,
      },
      ctx.projectRoot,
    );

    if (stopped) {
      yield await emit(assignment.sessionId, { type: "seat.state_changed", seatId: assignment.targetSeatId, state: "stopped", ts: finishedAt }, ctx.projectRoot);
    } else if (ok) {
      yield await emit(assignment.sessionId, { type: "assignment.completed", assignmentId: assignment.id, seatId: assignment.targetSeatId, ts: finishedAt }, ctx.projectRoot);
      yield await emit(assignment.sessionId, { type: "seat.state_changed", seatId: assignment.targetSeatId, state: "done", ts: finishedAt }, ctx.projectRoot);
    } else {
      const error = timedOut ? "进程超时或已被终止。" : stderr || `进程退出码异常：${result.exitCode ?? "未知"}`;
      yield await emit(assignment.sessionId, { type: "assignment.failed", assignmentId: assignment.id, seatId: assignment.targetSeatId, error, ts: finishedAt }, ctx.projectRoot);
      yield await emit(assignment.sessionId, { type: "seat.state_changed", seatId: assignment.targetSeatId, state: "failed", ts: finishedAt }, ctx.projectRoot);
    }
  }

  async stop(instanceId: string): Promise<void> {
    const child = running.get(instanceId);
    if (!child) return;
    stopRequested.add(instanceId);
    killProcessTree(child.pid);
    running.delete(instanceId);
  }
}

export function assignmentPrompt(assignment: Assignment): string {
  return [
    formatContextPack(assignment.contextPack),
    "",
    "完成任务后，请在 worktree 根目录写入 AGENTROOM_SUMMARY.md，并使用 YAML front matter 字段：",
    "summary, changed_files, tests, claims.",
  ].join("\n");
}

export async function runCapture(cmd: RunnerCommand, cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number | null; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd.command, cmd.args, { cwd, shell: needsShell(cmd.command), windowsHide: true, env: process.env });
    if (cmd.stdin !== undefined) {
      child.stdin.end(cmd.stdin);
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value: { stdout: string; stderr: string; exitCode: number | null; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => {
      killProcessTree(child.pid);
      child.stdout.destroy();
      child.stderr.destroy();
      child.stdin.destroy();
      child.removeAllListeners();
      child.unref();
      finish({ stdout, stderr, exitCode: null, error: `执行超时：${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish({ stdout, stderr, exitCode: null, error: error.message });
    });
    child.on("close", (code) => {
      finish({ stdout, stderr, exitCode: code });
    });
  });
}

function needsShell(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
    child.on("error", () => resolve({ exitCode: null, signal: null }));
  });
}

async function emit<T extends AgentRoomEvent>(sessionId: string, event: T, projectRoot: string): Promise<T> {
  await appendEvent(sessionId, event, projectRoot);
  return event;
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
      detached: true,
    });
    killer.unref();
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have already exited.
    }
  }
}
