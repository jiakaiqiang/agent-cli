#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { runCorridor } from "./corridor.js";
import { runProbe } from "./probe.js";
import { runRecover } from "./recover.js";
import { AgentRoomApp } from "./tui/App.js";

const args = process.argv.slice(2);

async function main(): Promise<void> {
  const [command, ...rest] = args;

  switch (command) {
    case undefined:
    case "-h":
    case "--help":
    case "help":
      printHelp();
      return;
    case "probe":
      await runProbe();
      return;
    case "run":
    case "corridor":
      await runCorridor(rest);
      return;
    case "tui":
      render(<AgentRoomApp />);
      return;
    case "recover":
      await runRecover(rest[0]);
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

function printHelp(): void {
  console.log(`AgentRoom

Usage:
  agentroom probe
  agentroom run [--runner codex|claude|gemini] [--seat codex-1] [--allow-dirty] "task"
  agentroom tui
  agentroom recover [sessionId]

Examples:
  agentroom probe
  agentroom run --runner codex --allow-dirty "update README"
  agentroom tui
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
