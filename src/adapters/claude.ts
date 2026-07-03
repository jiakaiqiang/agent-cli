import { ProcessRunnerAdapter, type RunnerCommand } from "./runner.js";
import type { RunnerType } from "../types.js";

export class ClaudeAdapter extends ProcessRunnerAdapter {
  type: RunnerType = "claude";
  displayName = "Claude";

  versionCommand(): RunnerCommand {
    return { command: process.env.AGENTROOM_CLAUDE_BIN ?? defaultClaudeCommand(), args: ["--version"] };
  }

  promptCommand(prompt: string): RunnerCommand {
    return {
      command: process.env.AGENTROOM_CLAUDE_BIN ?? defaultClaudeCommand(),
      args: ["-p"],
      stdin: prompt,
    };
  }
}

function defaultClaudeCommand(): string {
  return process.platform === "win32" ? "claude.cmd" : "claude";
}
