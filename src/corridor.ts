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
    onEvent: (event) => {
      if (event.type === "activity.appended") {
        console.log(event.text);
      }
    },
  });
  console.log(`Session: ${session.id}`);
  console.log(`Seat path: ${result.seatPath}`);
  console.log(`Worktree path: ${result.worktreePath}`);
}

export function parseCorridorArgs(args: string[]): CorridorOptions {
  let runner: RunnerType = "codex";
  let seatId = "codex-1";
  let allowDirty = false;
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
    taskParts.push(arg);
  }

  const task = taskParts.join(" ").trim();
  if (!task) {
    throw new Error('Usage: agentroom run [--runner codex|claude|gemini] [--seat codex-1] [--allow-dirty] "task"');
  }
  return { runner, seatId, task, allowDirty };
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
