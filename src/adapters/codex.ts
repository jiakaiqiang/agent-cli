import { ProcessRunnerAdapter, type RunnerCommand } from "./runner.js";
import type { RunnerType } from "../types.js";

export class CodexAdapter extends ProcessRunnerAdapter {
  type: RunnerType = "codex";
  displayName = "Codex";

  versionCommand(): RunnerCommand {
    return { command: process.env.AGENTROOM_CODEX_BIN ?? defaultCodexCommand(), args: ["--version"] };
  }

  promptCommand(prompt: string): RunnerCommand {
    return {
      command: process.env.AGENTROOM_CODEX_BIN ?? defaultCodexCommand(),
      args: ["exec", "-"],
      stdin: prompt,
    };
  }
}

function defaultCodexCommand(): string {
  return process.platform === "win32" ? "codex.cmd" : "codex";
}
