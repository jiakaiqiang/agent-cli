import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";
import { formatContextPack } from "../contextpack.js";
import type { AgentControlMode, AgentRoomEvent, Assignment, RunnerProbe, RunnerType, SeatStateFile } from "../types.js";
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
  promptCommand(prompt: string, controlMode?: AgentControlMode): RunnerCommand;
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
  abstract promptCommand(prompt: string, controlMode?: AgentControlMode): RunnerCommand;
  createStdoutParser?(): (chunk: string) => string[];

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
      currentAction: "starting runner",
      workspacePath: ctx.cwd,
      controlMode: assignment.controlMode,
      startedAt: now,
      updatedAt: now,
    };
    await writeSeatState(assignment.sessionId, baseState, ctx.projectRoot);
    yield await emit(assignment.sessionId, { type: "assignment.started", assignmentId: assignment.id, seatId: assignment.targetSeatId, ts: now }, ctx.projectRoot);
    yield await emit(assignment.sessionId, { type: "seat.state_changed", seatId: assignment.targetSeatId, state: "running", ts: now }, ctx.projectRoot);

    const prompt = assignmentPrompt(assignment);
    const command = this.promptCommand(prompt, assignment.controlMode);
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
    let stdoutTail = "";
    const activityQueue: AgentRoomEvent[] = [];
    let wakeActivityQueue: (() => void) | undefined;
    let processExited = false;
    let exitResult: { exitCode: number | null; signal: NodeJS.Signals | null } | undefined;
    const pendingWrites = new Set<Promise<unknown>>();
    const wake = () => {
      wakeActivityQueue?.();
      wakeActivityQueue = undefined;
    };
    const persist = (promise: Promise<unknown>) => {
      const tracked = promise.catch(() => undefined).finally(() => {
        pendingWrites.delete(tracked);
      });
      pendingWrites.add(tracked);
    };
    const flushPendingWrites = async () => {
      while (pendingWrites.size > 0) {
        await Promise.all([...pendingWrites]);
      }
    };
    const enqueueLines = (lines: string[]) => {
      if (lines.length === 0) return;
      for (const line of lines) {
        const event: AgentRoomEvent = {
          type: "activity.appended",
          seatId: assignment.targetSeatId,
          text: line,
          ts: new Date().toISOString(),
        };
        activityQueue.push(event);
        persist(emit(assignment.sessionId, event, ctx.projectRoot));
      }
      const lastLine = lines[lines.length - 1];
      persist(
        writeSeatState(
          assignment.sessionId,
          {
            ...baseState,
            processId: child.pid,
            currentAction: lastLine,
            updatedAt: new Date().toISOString(),
          },
          ctx.projectRoot,
        ),
      );
      wake();
    };

    const parseStdout = this.createStdoutParser?.();
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutTail = keepTail(stdoutTail + text, 4000);
      if (parseStdout) {
        const lines = parseStdout(text);
        if (lines.length > 0) {
          persist(
            appendTranscript(
              assignment.sessionId,
              assignment.targetSeatId,
              `${lines.join("\n")}\n`,
              ctx.projectRoot,
            ),
          );
          enqueueLines(lines);
        }
        return;
      }
      persist(appendTranscript(assignment.sessionId, assignment.targetSeatId, text, ctx.projectRoot));
      enqueueLines(text.split(/\r?\n/).filter(Boolean));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      persist(appendTranscript(assignment.sessionId, assignment.targetSeatId, text, ctx.projectRoot));
    });

    const exitPromise = waitForExit(child).then((result) => {
      exitResult = result;
      processExited = true;
      wake();
      return result;
    });
    while (!processExited || activityQueue.length) {
      const event = activityQueue.shift();
      if (event) {
        yield event;
        continue;
      }
      await new Promise<void>((resolve) => {
        wakeActivityQueue = resolve;
      });
    }

    const result = exitResult ?? (await exitPromise);
    clearTimeout(timeout);
    running.delete(assignment.targetSeatId);
    await flushPendingWrites();

    const finishedAt = new Date().toISOString();
    const timedOut = result.signal !== null && result.exitCode === null;
    const stopped = stopRequested.delete(assignment.targetSeatId);
    const ok = result.exitCode === 0 && !timedOut;
    await writeSeatState(
      assignment.sessionId,
      {
        ...baseState,
        state: stopped ? "stopped" : ok ? "done" : "failed",
        currentAction: stopped ? "stopped" : ok ? "completed" : "failed",
        finishedAt,
        error: stopped ? undefined : ok ? undefined : buildErrorMessage({ timedOut: false, stderr, stdoutTail, exitCode: result.exitCode }),
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
      const error = buildErrorMessage({ timedOut, stderr, stdoutTail, exitCode: result.exitCode });
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
    controlModeInstruction(assignment.controlMode),
    "",
    formatContextPack(assignment.contextPack),
    "",
    "完成任务后，请在 worktree 根目录写入 AGENTROOM_SUMMARY.md，并使用 YAML front matter 字段：",
    "summary, changed_files, tests, claims.",
  ].join("\n");
}

function controlModeInstruction(controlMode: AgentControlMode): string {
  switch (controlMode) {
    case "plan":
      return "AgentRoom control mode: plan. Analyze the task and propose a concrete plan only. Do not modify files or run write/destructive commands.";
    case "accept":
      return "AgentRoom control mode: accept. Work normally, but ask for confirmation before high-risk or destructive operations.";
    case "full":
      return "AgentRoom control mode: full. Execute the task end-to-end without routine confirmations. Avoid destructive actions unless they are required by the task.";
  }
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

function keepTail(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(text.length - maxLength);
}

function buildErrorMessage(opts: { timedOut: boolean; stderr: string; stdoutTail: string; exitCode: number | null }): string {
  if (opts.timedOut) return "进程超时或已被终止。";
  const stderrTrimmed = opts.stderr.trim();
  if (stderrTrimmed) return stderrTrimmed;
  const stdoutTrimmed = opts.stdoutTail.trim();
  if (stdoutTrimmed) {
    const lastLines = stdoutTrimmed.split(/\r?\n/).filter(Boolean).slice(-3).join("\n");
    return `进程退出码异常：${opts.exitCode ?? "未知"}\n${lastLines}`;
  }
  return `进程退出码异常：${opts.exitCode ?? "未知"}`;
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
