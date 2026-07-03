import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { GeminiAdapter } from "./gemini.js";
import type { RunnerAdapter } from "./runner.js";
import type { RunnerType } from "../types.js";

export function allAdapters(): RunnerAdapter[] {
  return [new CodexAdapter(), new ClaudeAdapter(), new GeminiAdapter()];
}

export function adapterFor(type: RunnerType): RunnerAdapter {
  const adapter = allAdapters().find((candidate) => candidate.type === type);
  if (!adapter) throw new Error(`没有找到 runner 类型对应的 adapter：${type}`);
  return adapter;
}
