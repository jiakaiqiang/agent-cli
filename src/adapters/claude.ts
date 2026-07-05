import { ProcessRunnerAdapter, type RunnerCommand } from "./runner.js";
import type { AgentControlMode, RunnerType } from "../types.js";

export class ClaudeAdapter extends ProcessRunnerAdapter {
  type: RunnerType = "claude";
  displayName = "Claude";

  versionCommand(): RunnerCommand {
    return { command: process.env.AGENTROOM_CLAUDE_BIN ?? defaultClaudeCommand(), args: ["--version"] };
  }

  promptCommand(prompt: string, controlMode: AgentControlMode = "accept"): RunnerCommand {
    if (process.env.AGENTROOM_CLAUDE_TRANSPORT === "terminal") {
      return {
        command: process.env.AGENTROOM_CLAUDE_BIN ?? defaultClaudeCommand(),
        args: ["--permission-mode", "default", prompt],
        terminal: true,
      };
    }
    return {
      command: process.env.AGENTROOM_CLAUDE_BIN ?? defaultClaudeCommand(),
      args: claudePrintArgs(controlMode),
      stdin: prompt,
    };
  }

  createStdoutParser(): (chunk: string) => string[] {
    return createClaudeStreamParser();
  }
}

function defaultClaudeCommand(): string {
  return process.platform === "win32" ? "claude.cmd" : "claude";
}

function claudePrintArgs(controlMode: AgentControlMode): string[] {
  const permissionMode =
    controlMode === "plan"
      ? "plan"
      : controlMode === "full"
        ? "bypassPermissions"
        : "acceptEdits";
  return ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", permissionMode];
}

function createClaudeStreamParser(): (chunk: string) => string[] {
  let partial = "";
  return (chunk: string) => {
    const combined = partial + chunk;
    const lines = combined.split(/\r?\n/);
    partial = lines.pop() ?? "";
    const output: string[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      output.push(...formatClaudeEvent(line));
    }
    return output;
  };
}

function formatClaudeEvent(line: string): string[] {
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    return [line];
  }
  if (!isRecord(payload)) return [line];

  switch (payload.type) {
    case "system":
      if (payload.subtype === "init") {
        const sessionId = typeof payload.session_id === "string" ? payload.session_id : "?";
        return [`#meta Claude session ${sessionId} started`];
      }
      return [];
    case "assistant":
    case "user":
      return extractContentBlocks(payload).flatMap(formatContentBlock);
    case "result":
      return formatResultEvent(payload);
    default:
      return [];
  }
}

function extractContentBlocks(payload: Record<string, unknown>): unknown[] {
  const message = payload.message;
  if (!isRecord(message)) return [];
  const content = message.content;
  if (!Array.isArray(content)) return [];
  return content;
}

function formatContentBlock(block: unknown): string[] {
  if (!isRecord(block)) return [];
  switch (block.type) {
    case "text":
      return splitLines(String(block.text ?? "")).map((line) => `Claude: ${line}`);
    case "thinking":
      return [];
    case "tool_use": {
      const name = typeof block.name === "string" ? block.name : "tool";
      return [`#meta Claude is using ${name}`];
    }
    case "tool_result":
      return [];
    default:
      return [];
  }
}

function formatResultEvent(payload: Record<string, unknown>): string[] {
  const parts: string[] = [];
  if (typeof payload.subtype === "string" && payload.subtype !== "success") {
    parts.push(`#meta Claude result: ${payload.subtype}`);
  }
  const duration = typeof payload.duration_ms === "number" ? `${Math.round(payload.duration_ms / 100) / 10}s` : undefined;
  const cost = typeof payload.total_cost_usd === "number" ? `$${payload.total_cost_usd.toFixed(4)}` : undefined;
  const stats = [duration, cost].filter(Boolean).join(" ");
  if (stats) parts.push(`#meta Claude ${stats}`);
  return parts;
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
