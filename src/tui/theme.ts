import type { RunnerType } from "../types.js";

export const tuiTheme = {
  accent: "cyan",
  agent: "green",
  border: "gray",
  borderActive: "cyan",
  dim: "gray",
  error: "red",
  input: "cyan",
  meta: "gray",
  panel: "white",
  system: "gray",
  text: "white",
  warning: "yellow",
} as const;

export const runnerTheme: Record<
  RunnerType,
  {
    label: string;
    short: string;
    color: string;
    description: string;
    command: string;
    bestFor: string;
  }
> = {
  codex: {
    label: "Codex",
    short: "CX",
    color: "cyan",
    description: "OpenAI coding agent for implementation and local changes.",
    command: "codex",
    bestFor: "Precise edits, tests, and repo-aware implementation.",
  },
  claude: {
    label: "Claude Code",
    short: "CL",
    color: "yellow",
    description: "Anthropic coding agent for broad codebase reasoning.",
    command: "claude",
    bestFor: "Architecture review, refactors, and long-context reasoning.",
  },
  gemini: {
    label: "Gemini CLI",
    short: "GM",
    color: "magenta",
    description: "Google terminal agent with multimodal and tool support.",
    command: "gemini",
    bestFor: "Research-heavy tasks, cross-checking, and large context.",
  },
};
