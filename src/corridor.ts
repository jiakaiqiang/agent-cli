import path from "node:path";
import { pathToFileURL } from "node:url";
import { runSeatAssignment } from "./assignment.js";
import { createSession, writeText } from "./storage.js";
import type { RunnerType } from "./types.js";

type CorridorOptions = {
  runner: RunnerType;
  seatId: string;
  task: string;
  allowDirty: boolean;
  timeoutMs?: number;
};

export async function runCorridor(args = process.argv.slice(2)): Promise<void> {
  const options = parseCorridorArgs(args);
  const projectRoot = process.cwd();
  const session = await createSession({ title: options.task, projectPath: projectRoot }, projectRoot);
  const result = await runSeatAssignment({
    projectRoot,
    sessionId: session.id,
    runner: options.runner,
    seatId: options.seatId,
    instruction: options.task,
    sourceSeatIds: [],
    allowDirty: options.allowDirty,
    timeoutMs: options.timeoutMs,
    onEvent: (event) => {
      if (event.type === "activity.appended") {
        console.log(event.text);
      }
    },
  });
  console.log(`Session: ${session.id}`);
  console.log(`Seat path: ${result.seatPath}`);
  console.log(`Worktree path: ${result.worktreePath}`);
  if (result.status !== "done") {
    console.error(result.error ?? `Assignment ${result.status}.`);
    process.exitCode = 1;
  }
}

export function parseCorridorArgs(args: string[]): CorridorOptions {
  let runner: RunnerType = "codex";
  let seatId = "codex-1";
  let allowDirty = false;
  let timeoutMs: number | undefined;
  const taskParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--runner") {
      runner = parseRunner(args[++index]);
      seatId = `${runner}-1`;
      continue;
    }
    if (arg === "--seat") {
      seatId = args[++index];
      continue;
    }
    if (arg === "--allow-dirty") {
      allowDirty = true;
      continue;
    }
    if (arg === "--timeout") {
      timeoutMs = parseTimeout(args[++index]);
      continue;
    }
    taskParts.push(arg);
  }

  const task = taskParts.join(" ").trim();
  if (!task) {
    throw new Error('Usage: agentroom run [--runner codex|claude|gemini] [--seat codex-1] [--allow-dirty] [--timeout 30m|1800s|1800] "task"');
  }
  return { runner, seatId, task, allowDirty, timeoutMs };
}

function parseTimeout(value: string | undefined): number {
  if (!value) throw new Error("--timeout requires a value like 30m, 1800s, or 1800 (seconds)");
  const match = /^(\d+)(m|s)?$/i.exec(value.trim());
  if (!match) throw new Error(`Invalid --timeout value: ${value}. Use 30m, 1800s, or 1800.`);
  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  return unit === "m" ? amount * 60_000 : amount * 1_000;
}

function parseRunner(value: string | undefined): RunnerType {
  if (value === "codex" || value === "claude" || value === "gemini") return value;
  throw new Error(`Unsupported runner: ${value}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCorridor().catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    await writeText(path.join(process.cwd(), ".agentroom", "last-error.log"), `${message}\n`);
    console.error(message);
    process.exitCode = 1;
  });
}
