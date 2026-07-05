import { ProcessRunnerAdapter, type RunnerCommand } from "./runner.js";
import type { AgentControlMode, RunnerType } from "../types.js";

export class CodexAdapter extends ProcessRunnerAdapter {
  type: RunnerType = "codex";
  displayName = "Codex";

  versionCommand(): RunnerCommand {
    return { command: process.env.AGENTROOM_CODEX_BIN ?? defaultCodexCommand(), args: ["--version"] };
  }

  promptCommand(prompt: string, controlMode: AgentControlMode = "accept"): RunnerCommand {
    return {
      command: process.env.AGENTROOM_CODEX_BIN ?? defaultCodexCommand(),
      args: codexExecArgs(controlMode),
      stdin: prompt,
    };
  }
}

function codexExecArgs(controlMode: AgentControlMode): string[] {
  switch (controlMode) {
    case "plan":
      return ["--sandbox", "read-only", "--ask-for-approval", "never", "exec", "-"];
    case "accept":
      return ["--sandbox", "workspace-write", "--ask-for-approval", "on-request", "exec", "-"];
    case "full":
      return ["--dangerously-bypass-approvals-and-sandbox", "exec", "-"];
  }
}

function defaultCodexCommand(): string {
  return process.platform === "win32" ? "codex.cmd" : "codex";
}
