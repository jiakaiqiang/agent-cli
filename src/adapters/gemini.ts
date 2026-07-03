import { ProcessRunnerAdapter, type RunnerCommand } from "./runner.js";
import type { RunnerType } from "../types.js";

export class GeminiAdapter extends ProcessRunnerAdapter {
  type: RunnerType = "gemini";
  displayName = "Gemini";

  versionCommand(): RunnerCommand {
    return { command: process.env.AGENTROOM_GEMINI_BIN ?? defaultGeminiCommand(), args: ["--version"] };
  }

  promptCommand(prompt: string): RunnerCommand {
    return {
      command: process.env.AGENTROOM_GEMINI_BIN ?? defaultGeminiCommand(),
      args: ["-p"],
      stdin: prompt,
    };
  }
}

function defaultGeminiCommand(): string {
  return process.platform === "win32" ? "gemini.cmd" : "gemini";
}
