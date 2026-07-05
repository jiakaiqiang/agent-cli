import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";
import { appendEvent, appendTranscript, writeSeatState } from "../storage.js";
import type { AgentControlMode, AgentRoomEvent, Assignment, RunnerProbe, RunnerType, SeatStateFile } from "../types.js";
import { assignmentPrompt, ProcessRunnerAdapter, runCapture, type RunnerCommand, type RunnerRunContext } from "./runner.js";

type AppServerResult = {
  ok: boolean;
  stopped: boolean;
  error?: string;
};

type JsonRecord = Record<string, unknown>;
type DeltaBuffer = { prefix: string; text: string };

const running = new Map<string, ChildProcessWithoutNullStreams>();
const stopRequested = new Set<string>();
const heartbeatIntervalMs = 2_000;
const pendingApprovals = new Map<
  string,
  {
    requestId: string;
    method: string;
    params: JsonRecord;
    send: (message: JsonRecord) => void;
  }
>();

export class CodexAdapter extends ProcessRunnerAdapter {
  type: RunnerType = "codex";
  displayName = "Codex";

  versionCommand(): RunnerCommand {
    return { command: process.env.AGENTROOM_CODEX_BIN ?? defaultCodexCommand(), args: ["--version"] };
  }

  promptCommand(prompt: string, controlMode: AgentControlMode = "accept", ctx?: RunnerRunContext): RunnerCommand {
    if (process.env.AGENTROOM_CODEX_TRANSPORT === "exec") {
      return {
        command: process.env.AGENTROOM_CODEX_BIN ?? defaultCodexCommand(),
        args: codexExecArgs(controlMode, Boolean(ctx?.skipGitRepoCheck)),
        stdin: prompt,
      };
    }
    return {
      command: process.env.AGENTROOM_CODEX_BIN ?? defaultCodexCommand(),
      args: ["app-server", "--stdio"],
      stdin: prompt,
    };
  }

  async probe(projectRoot = process.cwd()): Promise<RunnerProbe> {
    const started = Date.now();
    const command = this.versionCommand();
    const version = await runCapture(command, projectRoot, 15_000);
    const probe: RunnerProbe = {
      type: this.type,
      available: version.exitCode === 0,
      command: command.command,
      version: version.stdout.trim() || version.stderr.trim() || undefined,
      versionExitCode: version.exitCode,
      stderr: version.stderr,
      error: version.error,
      durationMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    };
    if (!probe.available) return probe;

    const prompt = await runCodexAppServerCapture("请只回复：agentroom-probe-ok", {
      cwd: projectRoot,
      controlMode: "accept",
      timeoutMs: 60_000,
    });
    probe.promptExitCode = prompt.exitCode;
    probe.stdout = prompt.stdout;
    probe.stderr = [probe.stderr, prompt.stderr].filter(Boolean).join("\n");
    probe.supportsStreaming = true;
    probe.supportsStructuredOutput = true;
    probe.available = prompt.exitCode === 0 && prompt.stdout.includes("agentroom-probe-ok");
    probe.error = probe.available ? undefined : (prompt.error ?? prompt.stderr) || "Codex app-server probe failed.";
    probe.durationMs = Date.now() - started;
    return probe;
  }

  async *run(assignment: Assignment, ctx: RunnerRunContext): AsyncIterable<AgentRoomEvent> {
    const now = new Date().toISOString();
    const baseState: SeatStateFile = {
      seatId: assignment.targetSeatId,
      runnerType: this.type,
      state: "running",
      currentTask: assignment.instruction,
      currentAction: "starting Codex",
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
    const commandLine = `AgentRoom: runner command: ${formatCommandForLog(command)} (clientInfo codex-tui)`;
    await appendTranscript(assignment.sessionId, assignment.targetSeatId, `${commandLine}\n`, ctx.projectRoot);
    yield await emit(
      assignment.sessionId,
      { type: "activity.appended", seatId: assignment.targetSeatId, text: commandLine, ts: new Date().toISOString() },
      ctx.projectRoot,
    );

    const child = spawn(command.command, command.args, {
      cwd: ctx.cwd,
      shell: needsShell(command.command),
      windowsHide: true,
      env: {
        ...process.env,
        AGENTROOM_RUNNER_PROMPT: prompt,
      },
    });
    running.set(assignment.targetSeatId, child);
    await writeSeatState(assignment.sessionId, { ...baseState, processId: child.pid, updatedAt: new Date().toISOString() }, ctx.projectRoot);

    const activityQueue: AgentRoomEvent[] = [];
    const pendingWrites = new Set<Promise<unknown>>();
    let wakeActivityQueue: (() => void) | undefined;
    let stdoutPartial = "";
    let stderr = "";
    let result: AppServerResult | undefined;
    let threadStarted = false;
    let turnStarted = false;
    let lastActivityAt = Date.now();
    const streamedItems = new Set<string>();
    const deltaBuffers = new Map<string, DeltaBuffer>();

    const wake = () => {
      wakeActivityQueue?.();
      wakeActivityQueue = undefined;
    };
    const persist = (promise: Promise<unknown>) => {
      const tracked = promise.catch(() => undefined).finally(() => pendingWrites.delete(tracked));
      pendingWrites.add(tracked);
    };
    const flushPendingWrites = async () => {
      while (pendingWrites.size > 0) await Promise.all([...pendingWrites]);
    };
    const enqueueLines = (lines: string[]) => {
      const visible = lines.filter(Boolean);
      if (visible.length === 0) return;
      lastActivityAt = Date.now();
      for (const line of visible) {
        const event: AgentRoomEvent = { type: "activity.appended", seatId: assignment.targetSeatId, text: line, ts: new Date().toISOString() };
        activityQueue.push(event);
        persist(emit(assignment.sessionId, event, ctx.projectRoot));
      }
      const lastLine = visible[visible.length - 1];
      persist(
        appendTranscript(assignment.sessionId, assignment.targetSeatId, `${visible.join("\n")}\n`, ctx.projectRoot),
      );
      persist(
        writeSeatState(
          assignment.sessionId,
          {
            ...baseState,
            processId: child.pid,
            state: pendingApprovals.has(assignment.targetSeatId) ? "waiting_user" : "running",
            currentAction: pendingApprovals.has(assignment.targetSeatId) ? "waiting for upstream approval" : summarizeActivityLine(lastLine),
            needsUser: pendingApprovals.has(assignment.targetSeatId),
            updatedAt: new Date().toISOString(),
          },
          ctx.projectRoot,
        ),
      );
      wake();
    };
    const fail = (error: string) => {
      if (result) return;
      result = { ok: false, stopped: stopRequested.has(assignment.targetSeatId), error };
      wake();
    };
    const complete = (ok: boolean, error?: string) => {
      if (result) return;
      result = { ok, stopped: stopRequested.has(assignment.targetSeatId), error };
      wake();
    };
    const send = (message: JsonRecord) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const startThread = () => {
      if (threadStarted) return;
      threadStarted = true;
      const policy = codexPolicy(assignment.controlMode);
      send({
        id: "thread",
        method: "thread/start",
        params: {
          cwd: ctx.cwd,
          runtimeWorkspaceRoots: [ctx.cwd],
          approvalPolicy: policy.approvalPolicy,
          approvalsReviewer: "user",
          sandbox: policy.sandboxMode,
          threadSource: "user",
          ephemeral: true,
        },
      });
    };
    const startTurn = (threadId: string) => {
      if (turnStarted) return;
      turnStarted = true;
      const policy = codexPolicy(assignment.controlMode);
      send({
        id: "turn",
        method: "turn/start",
        params: {
          threadId,
          input: [{ type: "text", text: prompt, text_elements: [] }],
          cwd: ctx.cwd,
          runtimeWorkspaceRoots: [ctx.cwd],
          approvalPolicy: policy.approvalPolicy,
          approvalsReviewer: "user",
          sandboxPolicy: policy.sandboxPolicy,
        },
      });
    };
    const handleMessage = (message: JsonRecord) => {
      if (message.id === "init") {
        const userAgent = readPath(message, ["result", "userAgent"]);
        if (typeof userAgent === "string") enqueueLines([`#meta Codex app-server initialized: ${userAgent}`]);
        send({ method: "initialized" });
        startThread();
        return;
      }
      if (message.id === "thread") {
        const error = readError(message);
        if (error) {
          fail(error);
          return;
        }
        const threadId = readPath(message, ["result", "thread", "id"]);
        if (typeof threadId === "string") {
          enqueueLines([`#meta Codex thread ${threadId} started`]);
          startTurn(threadId);
        }
        return;
      }
      if (message.id === "turn") {
        const error = readError(message);
        if (error) fail(error);
        return;
      }

      const method = typeof message.method === "string" ? message.method : "";
      if (isCodexApprovalRequest(method)) {
        const requestId = typeof message.id === "string" ? message.id : undefined;
        const params = isRecord(message.params) ? message.params : {};
        if (!requestId) {
          enqueueLines([`#error Codex approval request missing id: ${method}`]);
          return;
        }
        pendingApprovals.set(assignment.targetSeatId, { requestId, method, params, send });
        enqueueLines(formatCodexApprovalRequest(method, params));
        persist(
          writeSeatState(
            assignment.sessionId,
            {
              ...baseState,
              processId: child.pid,
              state: "waiting_user",
              currentAction: "waiting for upstream approval",
              needsUser: true,
              updatedAt: new Date().toISOString(),
            },
            ctx.projectRoot,
          ),
        );
        return;
      }
      if (method === "serverRequest/resolved") {
        pendingApprovals.delete(assignment.targetSeatId);
        enqueueLines(["#system Upstream approval request resolved"]);
        return;
      }
      if (method === "error") {
        const error = formatAppServerError(message);
        enqueueLines([`#error ${error}`]);
        if (readPath(message, ["params", "willRetry"]) === false) fail(error);
        return;
      }
      if (method === "mcpServer/startupStatus/updated") {
        const name = String(readPath(message, ["params", "name"]) ?? "mcp");
        const status = String(readPath(message, ["params", "status"]) ?? "unknown");
        const error = readPath(message, ["params", "error"]);
        enqueueLines([error ? `#error MCP ${name} ${status}: ${error}` : `#meta MCP ${name} ${status}`]);
        return;
      }
      if (method === "thread/status/changed") {
        const status = readPath(message, ["params", "status", "type"]);
        if (typeof status === "string") enqueueLines([`#meta Codex status: ${status}`]);
        return;
      }
      if (method === "turn/started") {
        enqueueLines(["#meta Codex turn started"]);
        return;
      }
      if (isCodexDeltaNotification(method)) {
        const formatted = bufferCodexDelta(message, deltaBuffers);
        if (formatted.itemId) streamedItems.add(formatted.itemId);
        enqueueLines(formatted.lines);
        return;
      }
      if (method === "item/started" || method === "item/completed") {
        if (method === "item/completed") enqueueLines(flushCodexDeltaBufferForMessage(message, deltaBuffers));
        if (method === "item/completed" && shouldSkipCompletedItem(message, streamedItems)) {
          enqueueLines(formatCodexCompletedMarker(message));
          return;
        }
        enqueueLines(formatCodexItem(message));
        return;
      }
      if (method === "turn/completed") {
        enqueueLines(flushCodexDeltaBuffers(deltaBuffers));
        const status = readPath(message, ["params", "turn", "status"]);
        const error = readPath(message, ["params", "turn", "error", "message"]);
        complete(status === "completed", typeof error === "string" ? error : undefined);
      }
    };

    const timeout = setTimeout(() => {
      fail(`执行超时：${ctx.timeoutMs}ms`);
      killProcessTree(child.pid);
    }, ctx.timeoutMs);
    const heartbeat = setInterval(() => {
      if (result) return;
      if (Date.now() - lastActivityAt >= heartbeatIntervalMs) enqueueLines(["#thinking Codex is thinking..."]);
    }, heartbeatIntervalMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutPartial += chunk.toString("utf8");
      const lines = stdoutPartial.split(/\r?\n/);
      stdoutPartial = lines.pop() ?? "";
      for (const raw of lines) {
        const line = normalizeAppServerLine(raw);
        if (!line) continue;
        const message = parseAppServerLine(line);
        if (message) {
          handleMessage(message);
        } else {
          enqueueLines([`#stream ${line}`]);
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      enqueueLines(formatStderrActivity(text));
    });
    child.on("error", (error) => fail(error.message));
    child.on("close", (exitCode) => {
      if (!result) fail(`Codex app-server exited before turn completion: ${exitCode ?? "unknown"}`);
    });

    send({
      id: "init",
      method: "initialize",
      params: {
        clientInfo: { name: "codex-tui", title: "Codex", version: codexClientVersion() },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: [
            "command/exec/outputDelta",
            "item/agentMessage/delta",
            "item/plan/delta",
            "item/fileChange/outputDelta",
            "item/reasoning/summaryTextDelta",
            "item/reasoning/textDelta",
          ],
        },
      },
    });

    while (!result || activityQueue.length > 0) {
      const event = activityQueue.shift();
      if (event) {
        yield event;
        continue;
      }
      await new Promise<void>((resolve) => {
        wakeActivityQueue = resolve;
      });
    }

    clearTimeout(timeout);
    clearInterval(heartbeat);
    running.delete(assignment.targetSeatId);
    pendingApprovals.delete(assignment.targetSeatId);
    if (!child.killed) killProcessTree(child.pid);
    await flushPendingWrites();

    const stopped = stopRequested.delete(assignment.targetSeatId) || result.stopped;
    const ok = result.ok && !stopped;
    const finishedAt = new Date().toISOString();
    const error = stopped || ok ? undefined : (result.error ?? stderr.trim()) || "Codex app-server failed.";
    await writeSeatState(
      assignment.sessionId,
      {
        ...baseState,
        state: stopped ? "stopped" : ok ? "done" : "failed",
        currentAction: stopped ? "stopped" : ok ? "completed" : summarizeActivityLine(error),
        processId: child.pid,
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
      yield await emit(assignment.sessionId, { type: "assignment.failed", assignmentId: assignment.id, seatId: assignment.targetSeatId, error: error ?? "Codex failed", ts: finishedAt }, ctx.projectRoot);
      yield await emit(assignment.sessionId, { type: "seat.state_changed", seatId: assignment.targetSeatId, state: "failed", ts: finishedAt }, ctx.projectRoot);
    }
  }

  async sendInput(instanceId: string, data: string): Promise<boolean> {
    const pending = pendingApprovals.get(instanceId);
    if (!pending) return super.sendInput(instanceId, data);
    const decision = parseApprovalInput(data);
    if (!decision) return true;
    pending.send({
      id: pending.requestId,
      result: codexApprovalResponse(pending.method, pending.params, decision),
    });
    pendingApprovals.delete(instanceId);
    return true;
  }

  async stop(instanceId: string, processId?: number): Promise<void> {
    stopRequested.add(instanceId);
    pendingApprovals.delete(instanceId);
    const child = running.get(instanceId);
    if (child) {
      killProcessTree(child.pid);
      running.delete(instanceId);
      return;
    }
    killProcessTree(processId);
  }
}

async function runCodexAppServerCapture(
  prompt: string,
  opts: { cwd: string; controlMode: AgentControlMode; timeoutMs: number },
): Promise<{ stdout: string; stderr: string; exitCode: number | null; error?: string }> {
  return new Promise((resolve) => {
    const command = process.env.AGENTROOM_CODEX_BIN ?? defaultCodexCommand();
    const child = spawn(command, ["app-server", "--stdio"], {
      cwd: opts.cwd,
      shell: needsShell(command),
      windowsHide: true,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let partial = "";
    let threadStarted = false;
    let turnStarted = false;
    let settled = false;
    const finish = (value: { stdout: string; stderr: string; exitCode: number | null; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      killProcessTree(child.pid);
      resolve(value);
    };
    const send = (message: JsonRecord) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const startThread = () => {
      if (threadStarted) return;
      threadStarted = true;
      const policy = codexPolicy(opts.controlMode);
      send({
        id: "thread",
        method: "thread/start",
        params: {
          cwd: opts.cwd,
          runtimeWorkspaceRoots: [opts.cwd],
          approvalPolicy: policy.approvalPolicy,
          approvalsReviewer: "user",
          sandbox: policy.sandboxMode,
          threadSource: "user",
          ephemeral: true,
        },
      });
    };
    const startTurn = (threadId: string) => {
      if (turnStarted) return;
      turnStarted = true;
      const policy = codexPolicy(opts.controlMode);
      send({
        id: "turn",
        method: "turn/start",
        params: {
          threadId,
          input: [{ type: "text", text: prompt, text_elements: [] }],
          approvalPolicy: policy.approvalPolicy,
          approvalsReviewer: "user",
          sandboxPolicy: policy.sandboxPolicy,
        },
      });
    };
    const handle = (message: JsonRecord) => {
      if (message.id === "init") {
        send({ method: "initialized" });
        startThread();
        return;
      }
      if (message.id === "thread") {
        const error = readError(message);
        if (error) finish({ stdout, stderr, exitCode: 1, error });
        const threadId = readPath(message, ["result", "thread", "id"]);
        if (typeof threadId === "string") startTurn(threadId);
        return;
      }
      if (message.method === "item/completed") {
        for (const line of formatCodexItem(message)) {
          const text = line.replace(/^#(?:meta|error|thinking|stream)\s+/, "").replace(/^Codex:\s*/, "");
          stdout += `${text}\n`;
        }
      }
      if (message.method === "error") {
        const error = formatAppServerError(message);
        stderr += `${error}\n`;
        if (readPath(message, ["params", "willRetry"]) === false) finish({ stdout, stderr, exitCode: 1, error });
      }
      if (message.method === "turn/completed") {
        const status = readPath(message, ["params", "turn", "status"]);
        const error = readPath(message, ["params", "turn", "error", "message"]);
        finish({ stdout, stderr, exitCode: status === "completed" ? 0 : 1, error: typeof error === "string" ? error : undefined });
      }
    };
    const timeout = setTimeout(() => finish({ stdout, stderr, exitCode: null, error: `执行超时：${opts.timeoutMs}ms` }), opts.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      partial += chunk.toString("utf8");
      const lines = partial.split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const raw of lines) {
        const line = normalizeAppServerLine(raw);
        if (!line) continue;
        const message = parseAppServerLine(line);
        if (message) {
          handle(message);
        } else {
          stdout += `${line}\n`;
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += stripAnsi(chunk.toString("utf8"));
    });
    child.on("error", (error) => finish({ stdout, stderr, exitCode: null, error: error.message }));
    child.on("close", (code) => {
      if (!settled) finish({ stdout, stderr, exitCode: code, error: code === 0 ? undefined : "Codex app-server exited before completing probe." });
    });
    send({
      id: "init",
      method: "initialize",
      params: {
        clientInfo: { name: "codex-tui", title: "Codex", version: codexClientVersion() },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: [
            "command/exec/outputDelta",
            "item/agentMessage/delta",
            "item/plan/delta",
            "item/fileChange/outputDelta",
            "item/reasoning/summaryTextDelta",
            "item/reasoning/textDelta",
          ],
        },
      },
    });
  });
}

function codexPolicy(controlMode: AgentControlMode): {
  approvalPolicy: "never" | "on-request";
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  sandboxPolicy: JsonRecord;
} {
  switch (controlMode) {
    case "plan":
      return {
        approvalPolicy: "never",
        sandboxMode: "read-only",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      };
    case "full":
      return {
        approvalPolicy: "never",
        sandboxMode: "danger-full-access",
        sandboxPolicy: { type: "dangerFullAccess" },
      };
    case "accept":
      return {
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
        sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
      };
  }
}

function formatCodexItem(message: JsonRecord): string[] {
  const item = readPath(message, ["params", "item"]);
  if (!isRecord(item)) return [];
  const type = item.type;
  if (type === "agentMessage") {
    const text = typeof item.text === "string" ? item.text : "";
    return splitLines(text).map((line) => `Codex: ${line}`);
  }
  if (type === "reasoning") {
    const summary = Array.isArray(item.summary) ? item.summary : [];
    return summary.flatMap((entry) => (isRecord(entry) && typeof entry.text === "string" ? splitLines(entry.text).map((line) => `#thinking ${line}`) : []));
  }
  if (type === "commandExecution" || type === "toolCall") {
    const name = typeof item.name === "string" ? item.name : String(type);
    return [`#tool ${name}`];
  }
  if (type === "fileChange") {
    const path = typeof item.path === "string" ? item.path : "";
    return [`#meta file changed ${path}`.trimEnd()];
  }
  return [];
}

function isCodexDeltaNotification(method: string): boolean {
  return (
    method === "item/agentMessage/delta" ||
    method === "item/reasoning/summaryTextDelta" ||
    method === "item/reasoning/textDelta" ||
    method === "item/plan/delta" ||
    method === "item/commandExecution/outputDelta" ||
    method === "command/exec/outputDelta" ||
    method === "item/fileChange/outputDelta" ||
    method === "item/commandExecution/terminalInteraction"
  );
}

function bufferCodexDelta(message: JsonRecord, buffers: Map<string, DeltaBuffer>): { itemId?: string; lines: string[] } {
  const part = codexDeltaPart(message);
  if (!part || !part.text.trim()) return { itemId: part?.itemId, lines: [] };
  if (!part.itemId) return { itemId: part.itemId, lines: formatDeltaLines(part.text, part.prefix) };

  const existing = buffers.get(part.itemId);
  if (existing && existing.prefix !== part.prefix) {
    const flushed = formatDeltaLines(existing.text, existing.prefix);
    buffers.set(part.itemId, { prefix: part.prefix, text: part.text });
    return { itemId: part.itemId, lines: flushed };
  }

  const next = existing ? { prefix: existing.prefix, text: `${existing.text}${part.text}` } : { prefix: part.prefix, text: part.text };
  if (shouldFlushDelta(next.text)) {
    buffers.delete(part.itemId);
    return { itemId: part.itemId, lines: formatDeltaLines(next.text, next.prefix) };
  }

  buffers.set(part.itemId, next);
  return { itemId: part.itemId, lines: [] };
}

function codexDeltaPart(message: JsonRecord): { itemId?: string; prefix: string; text: string } | undefined {
  const method = typeof message.method === "string" ? message.method : "";
  const params = isRecord(message.params) ? message.params : {};
  const itemId = stringField(params, "itemId");

  if (method === "command/exec/outputDelta") {
    const stream = stringField(params, "stream") ?? "stdout";
    const decoded = decodeBase64Delta(rawStringField(params, "deltaBase64"));
    return { itemId, prefix: `#stream ${stream}: `, text: decoded };
  }

  if (method === "item/commandExecution/terminalInteraction") {
    return { itemId, prefix: "#stream stdin: ", text: rawStringField(params, "stdin") ?? "" };
  }

  const delta = rawStringField(params, "delta") ?? "";
  switch (method) {
    case "item/agentMessage/delta":
      return { itemId, prefix: "#assistant ", text: delta };
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
      return { itemId, prefix: "#thinking ", text: delta };
    case "item/plan/delta":
      return { itemId, prefix: "#meta plan: ", text: delta };
    case "item/commandExecution/outputDelta":
      return { itemId, prefix: "#stream ", text: delta };
    case "item/fileChange/outputDelta":
      return { itemId, prefix: "#stream patch: ", text: delta };
    default:
      return undefined;
  }
}

function flushCodexDeltaBufferForMessage(message: JsonRecord, buffers: Map<string, DeltaBuffer>): string[] {
  const item = readPath(message, ["params", "item"]);
  const itemId = isRecord(item) && typeof item.id === "string" ? item.id : undefined;
  if (!itemId) return [];
  const existing = buffers.get(itemId);
  if (!existing) return [];
  buffers.delete(itemId);
  return formatDeltaLines(existing.text, existing.prefix);
}

function flushCodexDeltaBuffers(buffers: Map<string, DeltaBuffer>): string[] {
  const lines: string[] = [];
  for (const [itemId, buffer] of buffers) {
    lines.push(...formatDeltaLines(buffer.text, buffer.prefix));
    buffers.delete(itemId);
  }
  return lines;
}

function shouldFlushDelta(value: string): boolean {
  const trimmed = value.trim();
  return value.includes("\n") || trimmed.length >= 48 || /[.!?;。！？；]$/.test(trimmed);
}

function shouldSkipCompletedItem(message: JsonRecord, streamedItems: Set<string>): boolean {
  const item = readPath(message, ["params", "item"]);
  if (!isRecord(item)) return false;
  const id = typeof item.id === "string" ? item.id : undefined;
  if (!id || !streamedItems.has(id)) return false;
  return item.type === "agentMessage" || item.type === "reasoning" || item.type === "plan";
}

function formatCodexCompletedMarker(message: JsonRecord): string[] {
  const item = readPath(message, ["params", "item"]);
  if (!isRecord(item)) return [];
  const type = typeof item.type === "string" ? item.type : "item";
  return [`#meta Codex ${type} completed`];
}

function formatDeltaLines(delta: string, prefix: string): string[] {
  const normalized = delta.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const chunks = normalized
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return chunks.flatMap((chunk) => wrapDeltaLine(chunk, 180).map((line) => `${prefix}${line}`));
}

function wrapDeltaLine(value: string, maxLength: number): string[] {
  if (value.length <= maxLength) return [value];
  const lines: string[] = [];
  for (let index = 0; index < value.length; index += maxLength) {
    lines.push(value.slice(index, index + maxLength));
  }
  return lines;
}

function decodeBase64Delta(value: string | undefined): string {
  if (!value) return "";
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
}

type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

function isCodexApprovalRequest(method: string): boolean {
  return (
    method === "execCommandApproval" ||
    method === "applyPatchApproval" ||
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval" ||
    method === "item/permissions/requestApproval"
  );
}

function parseApprovalInput(data: string): ApprovalDecision | undefined {
  const normalized = data.replace(/\r|\n/g, "").trim().toLowerCase();
  if (!normalized) return "accept";
  if (normalized === "y" || normalized === "yes" || normalized === "a" || normalized === "approve" || normalized === "accept") return "accept";
  if (normalized === "s" || normalized === "session") return "acceptForSession";
  if (normalized === "n" || normalized === "no" || normalized === "r" || normalized === "reject" || normalized === "deny" || normalized === "decline") return "decline";
  if (normalized === "c" || normalized === "cancel" || normalized === "\u001b") return "cancel";
  return undefined;
}

function codexApprovalResponse(method: string, params: JsonRecord, decision: ApprovalDecision): JsonRecord {
  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    return {
      decision:
        decision === "accept"
          ? "approved"
          : decision === "acceptForSession"
            ? "approved_for_session"
            : decision === "cancel"
              ? "abort"
              : "denied",
    };
  }
  if (method === "item/commandExecution/requestApproval") {
    return {
      decision:
        decision === "accept"
          ? "accept"
          : decision === "acceptForSession"
            ? "acceptForSession"
            : decision === "cancel"
              ? "cancel"
              : "decline",
    };
  }
  if (method === "item/fileChange/requestApproval") {
    return {
      decision:
        decision === "accept"
          ? "accept"
          : decision === "acceptForSession"
            ? "acceptForSession"
            : decision === "cancel"
              ? "cancel"
              : "decline",
    };
  }
  if (method === "item/permissions/requestApproval") {
    if (decision === "accept" || decision === "acceptForSession") {
      const permissions = isRecord(params.permissions) ? params.permissions : {};
      return {
        permissions: {
          ...(permissions.network ? { network: permissions.network } : {}),
          ...(permissions.fileSystem ? { fileSystem: permissions.fileSystem } : {}),
        },
        scope: decision === "acceptForSession" ? "session" : "turn",
      };
    }
    return { permissions: {}, scope: "turn" };
  }
  return { decision: decision === "accept" || decision === "acceptForSession" ? "accept" : "decline" };
}

function formatCodexApprovalRequest(method: string, params: JsonRecord): string[] {
  const lines = [`#approval Codex requests approval: ${approvalTitle(method)}`];
  const command = approvalCommand(method, params);
  const cwd = stringField(params, "cwd");
  const reason = stringField(params, "reason");
  const grantRoot = stringField(params, "grantRoot");
  if (command) lines.push(`#approval Command: ${command}`);
  if (cwd) lines.push(`#approval Cwd: ${cwd}`);
  if (reason) lines.push(`#approval Reason: ${reason}`);
  if (grantRoot) lines.push(`#approval Grant root: ${grantRoot}`);
  for (const line of formatRequestedPermissions(params)) lines.push(`#approval ${line}`);
  for (const line of formatFileChanges(params)) lines.push(`#approval ${line}`);
  lines.push("#approval y/a approve, s approve for session, n/r reject, c cancel");
  return lines;
}

function approvalTitle(method: string): string {
  switch (method) {
    case "execCommandApproval":
    case "item/commandExecution/requestApproval":
      return "run command";
    case "applyPatchApproval":
    case "item/fileChange/requestApproval":
      return "apply file changes";
    case "item/permissions/requestApproval":
      return "grant additional permissions";
    default:
      return method;
  }
}

function approvalCommand(method: string, params: JsonRecord): string | undefined {
  if (method === "execCommandApproval" && Array.isArray(params.command)) {
    return params.command.map((part) => String(part)).join(" ");
  }
  const command = stringField(params, "command");
  return command || undefined;
}

function formatRequestedPermissions(params: JsonRecord): string[] {
  const permissions = isRecord(params.permissions) ? params.permissions : undefined;
  if (!permissions) return [];
  const output: string[] = [];
  if (isRecord(permissions.fileSystem)) {
    const read = Array.isArray(permissions.fileSystem.read) ? permissions.fileSystem.read.map(String) : [];
    const write = Array.isArray(permissions.fileSystem.write) ? permissions.fileSystem.write.map(String) : [];
    if (read.length) output.push(`Read: ${read.join(", ")}`);
    if (write.length) output.push(`Write: ${write.join(", ")}`);
  }
  if (isRecord(permissions.network) && permissions.network.enabled !== undefined) {
    output.push(`Network: ${String(permissions.network.enabled)}`);
  }
  return output;
}

function formatFileChanges(params: JsonRecord): string[] {
  if (!isRecord(params.fileChanges)) return [];
  return Object.keys(params.fileChanges).slice(0, 8).map((file) => `File: ${file}`);
}

function stringField(value: JsonRecord, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}

function rawStringField(value: JsonRecord, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function formatAppServerError(message: JsonRecord): string {
  const errorMessage = readPath(message, ["params", "error", "message"]);
  const details = readPath(message, ["params", "error", "additionalDetails"]);
  return [errorMessage, details].filter((value): value is string => typeof value === "string" && value.length > 0).join(" - ") || "Codex app-server error";
}

function readError(message: JsonRecord): string | undefined {
  const error = message.error;
  if (!isRecord(error)) return undefined;
  return typeof error.message === "string" ? error.message : JSON.stringify(error);
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function summarizeActivityLine(line: string | undefined): string {
  const normalized = (line ?? "").replace(/^#(?:error|stream|meta|thinking|assistant|tool|tool-result|system|result)\s+/, "").trim();
  if (!normalized) return "running";
  return normalized.length <= 140 ? normalized : `${normalized.slice(0, 137)}...`;
}

function formatStderrActivity(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean)
    .map((line) => (isErrorLine(line) ? `#error ${line}` : `#stream ${line}`));
}

function isErrorLine(line: string): boolean {
  return /^(ERROR|error):/.test(line) || /Forbidden|Unauthorized|authentication|permission denied|退出码|超时/i.test(line);
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function normalizeAppServerLine(value: string): string {
  return stripAnsi(value).replace(/\0/g, "").trim();
}

function parseAppServerLine(line: string): JsonRecord | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    const start = line.indexOf("{");
    const end = line.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    try {
      const parsed = JSON.parse(line.slice(start, end + 1)) as unknown;
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}

function formatCommandForLog(command: RunnerCommand): string {
  return [command.command, ...command.args].map(quoteArg).join(" ");
}

function quoteArg(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function needsShell(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

function codexClientVersion(): string {
  const version = process.env.AGENTROOM_CODEX_CLIENT_VERSION;
  return version?.trim() || "0.142.5";
}

function codexExecArgs(controlMode: AgentControlMode, skipGitRepoCheck: boolean): string[] {
  const gitRepoArgs = skipGitRepoCheck ? ["--skip-git-repo-check"] : [];
  const execArgs = ["exec", ...gitRepoArgs, "-"];
  switch (controlMode) {
    case "plan":
      return ["--sandbox", "read-only", "--ask-for-approval", "never", ...execArgs];
    case "accept":
      return ["--sandbox", "workspace-write", "--ask-for-approval", "on-request", ...execArgs];
    case "full":
      return ["--dangerously-bypass-approvals-and-sandbox", ...execArgs];
  }
}

function defaultCodexCommand(): string {
  return process.platform === "win32" ? "codex.cmd" : "codex";
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
