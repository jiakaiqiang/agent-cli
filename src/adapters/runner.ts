import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";
import { shouldUseDirectAgentPrompt } from "../agent-meta.js";
import { formatContextPack } from "../contextpack.js";
import type { AgentControlMode, AgentRoomEvent, Assignment, RunnerProbe, RunnerType, SeatStateFile } from "../types.js";
import { appendEvent, appendTranscript, writeSeatState } from "../storage.js";

type IPty = {
  pid?: number;
  write(data: string): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (event: { exitCode: number }) => void): void;
};

export type RunnerRunContext = {
  projectRoot: string;
  cwd: string;
  timeoutMs: number;
  skipGitRepoCheck?: boolean;
};

export type RunnerCommand = {
  command: string;
  args: string[];
  stdin?: string;
  terminal?: boolean;
};

export interface RunnerAdapter {
  type: RunnerType;
  displayName: string;
  promptCommand(prompt: string, controlMode?: AgentControlMode, ctx?: RunnerRunContext): RunnerCommand;
  probe(projectRoot?: string): Promise<RunnerProbe>;
  run(assignment: Assignment, ctx: RunnerRunContext): AsyncIterable<AgentRoomEvent>;
  sendInput(instanceId: string, data: string): Promise<boolean>;
  stop(instanceId: string, processId?: number): Promise<void>;
}

const running = new Map<string, ChildProcessWithoutNullStreams>();
const runningTerminals = new Map<string, IPty>();
const waitingTerminals = new Set<string>();
const stopRequested = new Set<string>();
const heartbeatIntervalMs = 2_000;

export abstract class ProcessRunnerAdapter implements RunnerAdapter {
  abstract type: RunnerType;
  abstract displayName: string;
  abstract versionCommand(): RunnerCommand;
  abstract promptCommand(prompt: string, controlMode?: AgentControlMode, ctx?: RunnerRunContext): RunnerCommand;
  createStdoutParser?(): (chunk: string) => string[];

  async probe(projectRoot = process.cwd()): Promise<RunnerProbe> {
    const started = Date.now();
    const version = await runCapture(this.versionCommand(), projectRoot, 15_000);
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
    const command = this.promptCommand(prompt, assignment.controlMode, ctx);
    const commandLine = `AgentRoom: runner command: ${formatCommandForLog(command)}`;
    await appendTranscript(assignment.sessionId, assignment.targetSeatId, `${commandLine}\n`, ctx.projectRoot);
    yield await emit(
      assignment.sessionId,
      { type: "activity.appended", seatId: assignment.targetSeatId, text: commandLine, ts: new Date().toISOString() },
      ctx.projectRoot,
    );
    if (command.terminal) {
      yield* this.runTerminalCommand(assignment, ctx, baseState, command);
      return;
    }
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
    let lastActivityAt = Date.now();
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
            currentAction: summarizeActivityLine(lastLine),
            updatedAt: new Date().toISOString(),
          },
          ctx.projectRoot,
        ),
      );
      wake();
    };

    const heartbeat = setInterval(() => {
      if (processExited) return;
      if (Date.now() - lastActivityAt >= heartbeatIntervalMs) enqueueLines([`#thinking ${this.displayName} is thinking...`]);
    }, heartbeatIntervalMs);

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
      enqueueLines(formatStderrActivity(text));
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
    clearInterval(heartbeat);
    running.delete(assignment.targetSeatId);
    await flushPendingWrites();

    const finishedAt = new Date().toISOString();
    const timedOut = result.signal !== null && result.exitCode === null;
    const stopped = stopRequested.delete(assignment.targetSeatId);
    const ok = result.exitCode === 0 && !timedOut;
    const error = stopped || ok ? undefined : buildErrorMessage({ timedOut, stderr, stdoutTail, exitCode: result.exitCode });
    await writeSeatState(
      assignment.sessionId,
      {
        ...baseState,
        state: stopped ? "stopped" : ok ? "done" : "failed",
        currentAction: stopped ? "stopped" : ok ? "completed" : summarizeRunnerFailure(error),
        finishedAt,
        error,
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
      yield await emit(assignment.sessionId, { type: "assignment.failed", assignmentId: assignment.id, seatId: assignment.targetSeatId, error: error ?? "runner failed", ts: finishedAt }, ctx.projectRoot);
      yield await emit(assignment.sessionId, { type: "seat.state_changed", seatId: assignment.targetSeatId, state: "failed", ts: finishedAt }, ctx.projectRoot);
    }
  }

  private async *runTerminalCommand(
    assignment: Assignment,
    ctx: RunnerRunContext,
    baseState: SeatStateFile,
    command: RunnerCommand,
  ): AsyncIterable<AgentRoomEvent> {
    let terminal: IPty;
    try {
      const pty = await optionalImportPty();
      terminal = pty.spawn(command.command, command.args, {
        cwd: ctx.cwd,
        cols: Number(process.env.AGENTROOM_PTY_COLS ?? 120),
        rows: Number(process.env.AGENTROOM_PTY_ROWS ?? 40),
        name: "xterm-256color",
        env: {
          ...process.env,
          AGENTROOM_RUNNER_PROMPT: assignmentPrompt(assignment),
        },
      });
    } catch (error) {
      const ts = new Date().toISOString();
      const detail = error instanceof Error ? error.message : String(error);
      const message = `AgentRoom PTY unavailable: ${detail}`;
      await appendTranscript(assignment.sessionId, assignment.targetSeatId, `#error ${message}\n`, ctx.projectRoot);
      yield await emit(
        assignment.sessionId,
        { type: "activity.appended", seatId: assignment.targetSeatId, text: `#error ${message}`, ts },
        ctx.projectRoot,
      );
      await writeSeatState(
        assignment.sessionId,
        {
          ...baseState,
          state: "failed",
          currentAction: "interactive terminal unavailable",
          error: message,
          finishedAt: ts,
          updatedAt: ts,
        },
        ctx.projectRoot,
      );
      yield await emit(assignment.sessionId, { type: "assignment.failed", assignmentId: assignment.id, seatId: assignment.targetSeatId, error: message, ts }, ctx.projectRoot);
      yield await emit(assignment.sessionId, { type: "seat.state_changed", seatId: assignment.targetSeatId, state: "failed", ts }, ctx.projectRoot);
      return;
    }

    if (command.stdin !== undefined) {
      setTimeout(() => {
        terminal.write(`${command.stdin?.replace(/\r?\n/g, "\r")}\r`);
      }, 250);
    }

    runningTerminals.set(assignment.targetSeatId, terminal);
    await writeSeatState(
      assignment.sessionId,
      {
        ...baseState,
        processId: terminalProcessId(terminal),
        currentAction: "attached to upstream CLI",
        updatedAt: new Date().toISOString(),
      },
      ctx.projectRoot,
    );

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminal.kill();
    }, ctx.timeoutMs);

    let terminalTail = "";
    const parseTerminalActivity = createTerminalActivityParser();
    const activityQueue: AgentRoomEvent[] = [];
    let wakeActivityQueue: (() => void) | undefined;
    let processExited = false;
    let exitResult: { exitCode: number | null; signal: NodeJS.Signals | null } | undefined;
    let lastActivityAt = Date.now();
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
      lastActivityAt = Date.now();
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
      const needsUser = waitingTerminals.has(assignment.targetSeatId);
      persist(
        writeSeatState(
          assignment.sessionId,
          {
            ...baseState,
            processId: terminalProcessId(terminal),
            state: needsUser ? "waiting_user" : "running",
            currentAction: needsUser ? "waiting for upstream confirmation" : summarizeActivityLine(lastLine),
            needsUser,
            updatedAt: new Date().toISOString(),
          },
          ctx.projectRoot,
        ),
      );
      wake();
    };

    const heartbeat = setInterval(() => {
      if (processExited) return;
      if (Date.now() - lastActivityAt >= heartbeatIntervalMs) enqueueLines([`#thinking ${this.displayName} is thinking...`]);
    }, heartbeatIntervalMs);

    terminal.onData((chunk: string) => {
      const lines = parseTerminalActivity(chunk);
      if (lines.length > 0) {
        const text = `${lines.join("\n")}\n`;
        terminalTail = keepTail(`${terminalTail}${text}`, 4000);
        persist(appendTranscript(assignment.sessionId, assignment.targetSeatId, text, ctx.projectRoot));
        enqueueLines(lines);
      } else {
        terminalTail = keepTail(`${terminalTail}${stripAnsi(chunk)}`, 4000);
      }
      if (looksLikeUserConfirmation(terminalTail) && !waitingTerminals.has(assignment.targetSeatId)) {
        waitingTerminals.add(assignment.targetSeatId);
        const waitLine = "#system Upstream CLI is waiting for user confirmation; focused keystrokes are forwarded to it.";
        persist(appendTranscript(assignment.sessionId, assignment.targetSeatId, `${waitLine}\n`, ctx.projectRoot));
        enqueueLines([waitLine]);
      }
    });

    const exitPromise = waitForTerminalExit(terminal).then((result) => {
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
    clearInterval(heartbeat);
    runningTerminals.delete(assignment.targetSeatId);
    waitingTerminals.delete(assignment.targetSeatId);
    const remainingLines = parseTerminalActivity.flush();
    if (remainingLines.length > 0) {
      const text = `${remainingLines.join("\n")}\n`;
      terminalTail = keepTail(`${terminalTail}${text}`, 4000);
      await appendTranscript(assignment.sessionId, assignment.targetSeatId, text, ctx.projectRoot);
      enqueueLines(remainingLines);
      while (activityQueue.length > 0) {
        const event = activityQueue.shift();
        if (event) yield event;
      }
    }
    await flushPendingWrites();

    const finishedAt = new Date().toISOString();
    const stopped = stopRequested.delete(assignment.targetSeatId);
    const ok = result.exitCode === 0 && !timedOut;
    const error = stopped || ok ? undefined : buildErrorMessage({ timedOut, stderr: "", stdoutTail: terminalTail, exitCode: result.exitCode });
    await writeSeatState(
      assignment.sessionId,
      {
        ...baseState,
        state: stopped ? "stopped" : ok ? "done" : "failed",
        currentAction: stopped ? "stopped" : ok ? "completed" : summarizeRunnerFailure(error),
        processId: terminalProcessId(terminal),
        finishedAt,
        error,
        needsUser: false,
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
      yield await emit(assignment.sessionId, { type: "assignment.failed", assignmentId: assignment.id, seatId: assignment.targetSeatId, error: error ?? "runner failed", ts: finishedAt }, ctx.projectRoot);
      yield await emit(assignment.sessionId, { type: "seat.state_changed", seatId: assignment.targetSeatId, state: "failed", ts: finishedAt }, ctx.projectRoot);
    }
  }

  async stop(instanceId: string, processId?: number): Promise<void> {
    const terminal = runningTerminals.get(instanceId);
    if (terminal) {
      stopRequested.add(instanceId);
      terminal.kill();
      runningTerminals.delete(instanceId);
      waitingTerminals.delete(instanceId);
      return;
    }
    const child = running.get(instanceId);
    stopRequested.add(instanceId);
    if (child) {
      killProcessTree(child.pid);
      running.delete(instanceId);
      return;
    }
    killProcessTree(processId);
  }

  async sendInput(instanceId: string, data: string): Promise<boolean> {
    return sendRunnerInput(instanceId, data);
  }
}

export function sendRunnerInput(instanceId: string, data: string): boolean {
  const terminal = runningTerminals.get(instanceId);
  if (!terminal) return false;
  terminal.write(data);
  waitingTerminals.delete(instanceId);
  return true;
}

export function assignmentPrompt(assignment: Assignment): string {
  if (shouldUseDirectAgentPrompt(assignment.instruction)) {
    return assignment.instruction;
  }

  const contextFragment = assignment.assembledPrompt ?? formatContextPack(assignment.contextPack);

  return [
    controlModeInstruction(assignment.controlMode),
    "AgentRoom orchestration rule: do not start AgentRoom, dispatch other seats, or create nested git worktrees from inside this runner. If another seat is mentioned, complete only your assigned work and leave cross-agent routing to the AgentRoom TUI.",
    "",
    contextFragment,
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
      return "AgentRoom control mode: accept. Work normally; routine file edits are allowed by the runner. Do not perform destructive operations unless the user explicitly asked for them.";
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

function summarizeRunnerFailure(error: string | undefined): string {
  if (!error) return "failed";
  const lines = error.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const meaningful = [...lines].reverse().find((line) => /ERROR:|error:|Forbidden|Unauthorized|timeout|超时|退出码/.test(line)) ?? lines.at(-1);
  if (!meaningful) return "failed";
  return meaningful.length <= 140 ? meaningful : `${meaningful.slice(0, 137)}...`;
}

function summarizeActivityLine(line: string): string {
  const normalized = line.replace(/^#(?:error|stream|meta|thinking|assistant|tool|tool-result|system|result|terminal)\s+/, "").trim();
  if (!normalized) return "running";
  return normalized.length <= 140 ? normalized : `${normalized.slice(0, 137)}...`;
}

type TerminalActivityParser = ((chunk: string) => string[]) & { flush: () => string[] };

function createTerminalActivityParser(): TerminalActivityParser {
  let currentLine = "";
  const parser = ((chunk: string) => {
    const output: string[] = [];
    const text = cleanTerminalChunk(chunk);
    for (const char of text) {
      if (char === "\r") {
        currentLine = "";
        continue;
      }
      if (char === "\n") {
        const line = normalizeTerminalLine(currentLine);
        currentLine = "";
        if (line) output.push(`#terminal ${line}`);
        continue;
      }
      if (char === "\b" || char === "\x7f") {
        currentLine = currentLine.slice(0, -1);
        continue;
      }
      if (char >= " ") currentLine = keepTail(currentLine + char, 1000);
    }
    return output.slice(-30);
  }) as TerminalActivityParser;
  parser.flush = () => {
    const line = normalizeTerminalLine(currentLine);
    currentLine = "";
    return line ? [`#terminal ${line}`] : [];
  };
  return parser;
}

function cleanTerminalChunk(text: string): string {
  return stripAnsi(text)
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0007/g, "");
}

function normalizeTerminalLine(line: string): string | undefined {
  const normalized = line.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!normalized) return undefined;
  if (isTerminalUiFragment(normalized)) return undefined;
  return normalized;
}

function isTerminalUiFragment(line: string): boolean {
  if (line.length <= 3) return true;
  if (line.length <= 2 && !/[A-Za-z0-9\u4e00-\u9fff]/.test(line)) return true;
  if (/^[│┃┆┇║|╎╏╽╿╷╵╹╻╔╗╚╝╭╮╰╯┌┐└┘─━═\s]+$/.test(line)) return true;
  if (/^[*·•>\-\s]+$/.test(line)) return true;
  return false;
}

function looksLikeUserConfirmation(text: string): boolean {
  const normalized = stripAnsi(text).replace(/\s+/g, " ").toLowerCase();
  return [
    /requested permissions/,
    /permission request/,
    /waiting for user (approval|confirmation|permission)/,
    /do you want (to )?(continue|proceed|allow|run|execute)/,
    /\b(allow|approve|grant)\b.{0,80}\?/,
    /\b(permission|approval)\b.{0,120}\b(allow|approve|deny|reject|yes|no)\b/,
    /\b(yes|no|allow|deny|approve|reject)\b.{0,120}\b(yes|no|allow|deny|approve|reject)\b/,
    /请求.{0,20}(权限|授权|批准)/,
    /(是否|要).{0,40}(继续|执行|运行|允许|批准|授权)/,
    /(允许|批准|授权).{0,40}\?/,
  ].some((pattern) => pattern.test(normalized));
}

function formatStderrActivity(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean)
    .flatMap((line) => {
      const formatted = isErrorLine(line) ? `#error ${line}` : `#stream ${line}`;
      const diagnostic = codexExecBlockedDiagnostic(line);
      return diagnostic ? [formatted, diagnostic] : [formatted];
    });
}

function isErrorLine(line: string): boolean {
  return /^(ERROR|error):/.test(line) || /Forbidden|Unauthorized|authentication|permission denied|退出码|超时/i.test(line);
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function codexExecBlockedDiagnostic(line: string): string | undefined {
  if (!/codex_exec\/[\d.]+/.test(line) || !/Forbidden|不允许当前客户端使用/.test(line)) return undefined;
  return "#error AgentRoom diagnosis: 当前模型渠道拒绝 codex exec 无头客户端；交互式 codex 可用不代表 codex exec 可用。";
}

function formatCommandForLog(command: RunnerCommand): string {
  return [command.command, ...command.args].map(quoteArg).join(" ");
}

function quoteArg(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
    child.on("error", () => resolve({ exitCode: null, signal: null }));
  });
}

function waitForTerminalExit(terminal: IPty): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    terminal.onExit((event: { exitCode: number }) => resolve({ exitCode: event.exitCode, signal: null }));
  });
}

function terminalProcessId(terminal: IPty): number | undefined {
  const value = (terminal as unknown as { pid?: unknown }).pid;
  return typeof value === "number" ? value : undefined;
}

async function optionalImportPty(): Promise<{ spawn: (command: string, args: string[], options: Record<string, unknown>) => IPty }> {
  const load = Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  const module = await load("node-pty");
  if (typeof module === "object" && module !== null && "spawn" in module) {
    return module as { spawn: (command: string, args: string[], options: Record<string, unknown>) => IPty };
  }
  throw new Error("node-pty module does not expose spawn()");
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
