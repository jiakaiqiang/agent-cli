import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { adapterFor } from "./adapters/index.js";
import { runCapture } from "./adapters/runner.js";
import { buildContextPack } from "./contextpack.js";
import {
  appendEvent,
  appendTranscript,
  createSeat,
  seatPaths,
  worktreesDir,
  writePatch,
  writeSeatState,
  writeSummary,
} from "./storage.js";
import type { AgentControlMode, AgentRoomEvent, Assignment, RunnerType, SeatState } from "./types.js";

type GitCapture = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
};

type ExecutionWorkspace = {
  mode: "shared" | "worktree";
  cwd: string;
};

export type RunSeatAssignmentOptions = {
  projectRoot: string;
  sessionId: string;
  runner: RunnerType;
  seatId: string;
  instruction: string;
  sourceSeatIds: string[];
  controlMode?: AgentControlMode;
  timeoutMs?: number;
  allowDirty?: boolean;
  onEvent?: (event: AgentRoomEvent) => void | Promise<void>;
};

export type RunSeatAssignmentResult = {
  assignment: Assignment;
  seatPath: string;
  worktreePath: string;
  status: Extract<SeatState, "done" | "failed" | "stopped">;
  error?: string;
};

export async function runSeatAssignment(options: RunSeatAssignmentOptions): Promise<RunSeatAssignmentResult> {
  const createdAt = new Date().toISOString();
  const assignmentId = `assign_${Date.now()}`;
  const fallbackWorktreePath = path.join(worktreesDir(options.projectRoot), options.sessionId, `${options.seatId}-${Date.now()}`);
  let assignment: Assignment | undefined;
  let workspacePath = options.projectRoot;
  let finalStatus: RunSeatAssignmentResult["status"] = "done";
  let finalError: string | undefined;

  await createSeat(
    options.sessionId,
    {
      seatId: options.seatId,
      runnerType: options.runner,
      state: "queued",
      currentTask: options.instruction,
      currentAction: "queued",
      workspacePath,
      controlMode: options.controlMode ?? "accept",
      updatedAt: createdAt,
    },
    options.projectRoot,
  );
  await appendEvent(
    options.sessionId,
    { type: "seat.state_changed", seatId: options.seatId, state: "queued", ts: createdAt },
    options.projectRoot,
  );

  try {
    const workspace = await resolveExecutionWorkspace(options.projectRoot, fallbackWorktreePath, Boolean(options.allowDirty));
    workspacePath = workspace.cwd;
    await writeSeatState(
      options.sessionId,
      {
        seatId: options.seatId,
        runnerType: options.runner,
        state: "queued",
        currentTask: options.instruction,
        currentAction: workspace.mode === "worktree" ? "queued in worktree" : "queued in shared workspace",
        workspacePath,
        controlMode: options.controlMode ?? "accept",
        updatedAt: new Date().toISOString(),
      },
      options.projectRoot,
    );
    if (workspace.mode === "shared") {
      await appendTranscript(options.sessionId, options.seatId, "AgentRoom: 当前目录不是 git 仓库，将在共享工作区运行。\n", options.projectRoot);
      await appendEvent(
        options.sessionId,
        {
          type: "activity.appended",
          seatId: options.seatId,
          text: "当前目录不是 git 仓库，将在共享工作区运行。",
          ts: new Date().toISOString(),
        },
        options.projectRoot,
      );
    }

    const contextPack = await buildContextPack(options.sessionId, options.instruction, options.sourceSeatIds, options.projectRoot);
    assignment = {
      id: assignmentId,
      sessionId: options.sessionId,
      targetSeatId: options.seatId,
      sourceSeatIds: options.sourceSeatIds,
      instruction: options.instruction,
      contextPack,
      controlMode: options.controlMode ?? "accept",
      status: "queued",
      createdAt,
    };

    const adapter = adapterFor(options.runner);
    for await (const event of adapter.run(assignment, {
      projectRoot: options.projectRoot,
      cwd: workspace.cwd,
      timeoutMs: options.timeoutMs ?? 10 * 60_000,
      skipGitRepoCheck: workspace.mode === "shared",
    })) {
      if (event.type === "assignment.failed") {
        finalStatus = "failed";
        finalError = event.error;
      } else if (event.type === "seat.state_changed" && event.state === "stopped") {
        finalStatus = "stopped";
      } else if (event.type === "assignment.completed") {
        finalStatus = "done";
      }
      await options.onEvent?.(event);
    }

    const patch = workspace.mode === "worktree" ? await git(["diff"], workspace.cwd) : emptyGitCapture();
    const stat = workspace.mode === "worktree" ? await git(["diff", "--stat"], workspace.cwd) : emptyGitCapture();
    await writePatch(options.sessionId, options.seatId, patch.stdout, options.projectRoot);

    const summary = await collectSummary(workspace.cwd, options.instruction, stat.stdout, patch.stdout);
    await writeSummary(options.sessionId, options.seatId, summary, options.projectRoot);
  } catch (error) {
    const ts = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    await writeSeatState(
      options.sessionId,
      {
        seatId: options.seatId,
        runnerType: options.runner,
        state: "failed",
        currentTask: options.instruction,
        currentAction: summarizeError(message),
        workspacePath,
        controlMode: options.controlMode ?? "accept",
        error: message,
        updatedAt: ts,
      },
      options.projectRoot,
    );
    await appendTranscript(options.sessionId, options.seatId, `AgentRoom: ${message}\n`, options.projectRoot);
    await appendEvent(options.sessionId, { type: "assignment.failed", assignmentId, seatId: options.seatId, error: message, ts }, options.projectRoot);
    await appendEvent(options.sessionId, { type: "seat.state_changed", seatId: options.seatId, state: "failed", ts }, options.projectRoot);
    throw error;
  }

  return {
    assignment: assignment!,
    seatPath: seatPaths(options.sessionId, options.seatId, options.projectRoot).root,
    worktreePath: workspacePath,
    status: finalStatus,
    error: finalError,
  };
}

async function resolveExecutionWorkspace(projectRoot: string, worktreePath: string, allowDirty: boolean): Promise<ExecutionWorkspace> {
  const gitWorkspace = await isGitWorkspace(projectRoot);
  if (!gitWorkspace) {
    return {
      mode: "shared",
      cwd: projectRoot,
    };
  }

  await prepareWorktree(projectRoot, worktreePath, allowDirty);
  return {
    mode: "worktree",
    cwd: worktreePath,
  };
}

async function isGitWorkspace(projectRoot: string): Promise<boolean> {
  const result = await git(["rev-parse", "--is-inside-work-tree"], projectRoot);
  if (result.exitCode === 0) {
    return result.stdout.trim() === "true";
  }

  const diagnostics = `${result.stderr}\n${result.error ?? ""}`.toLowerCase();
  if (diagnostics.includes("not a git repository")) {
    return false;
  }

  throw new Error((result.error ?? result.stderr.trim()) || "Unable to determine whether the current directory is a git workspace.");
}

export async function prepareWorktree(projectRoot: string, worktreePath: string, allowDirty = false): Promise<void> {
  await mkdir(path.dirname(worktreePath), { recursive: true });

  const dirty = await git(["status", "--porcelain"], projectRoot);
  if (dirty.exitCode !== 0) {
    throw new Error((dirty.error ?? dirty.stderr.trim()) || "Unable to inspect git workspace state.");
  }
  if (!allowDirty && dirty.stdout.trim()) {
    throw new Error("The primary workspace has uncommitted changes. Pass --allow-dirty for local experiments.");
  }

  const branchName = `agentroom-${path.basename(path.dirname(worktreePath))}-${path.basename(worktreePath)}-${Date.now()}`;
  const result = await git(["worktree", "add", "-b", branchName, worktreePath, "HEAD"], projectRoot);
  if (result.exitCode !== 0) {
    throw new Error((result.error ?? result.stderr.trim()) || "Failed to create git worktree.");
  }
}

export async function collectSummary(workspacePath: string, task: string, diffStat: string, patch: string): Promise<string> {
  const summaryFile = path.join(workspacePath, "AGENTROOM_SUMMARY.md");
  try {
    return await readFile(summaryFile, "utf8");
  } catch {
    const changedFiles = parseDiffStatFiles(diffStat);
    return [
      "---",
      `summary: ${JSON.stringify(`Fallback summary for task: ${task}`)}`,
      "changed_files:",
      ...(changedFiles.length ? changedFiles.map((file) => `  - ${file}`) : ["  []"]),
      "tests: []",
      "claims: []",
      "---",
      "",
      "AgentRoom fallback summary.",
      "",
      "Diff stat:",
      diffStat.trim() || "(no diff stat)",
      "",
      patch.trim() ? "Patch written to patch.diff." : "No patch was produced.",
    ].join("\n");
  }
}

function parseDiffStatFiles(diffStat: string): string[] {
  return diffStat
    .split(/\r?\n/)
    .map((line) => line.split("|")[0]?.trim())
    .filter((value): value is string => Boolean(value && !value.includes("files changed")));
}

async function git(args: string[], cwd: string): Promise<GitCapture> {
  return runCapture({ command: "git", args }, cwd, 60_000);
}

function emptyGitCapture(): GitCapture {
  return { stdout: "", stderr: "", exitCode: 0 };
}

function summarizeError(message: string): string {
  return message.replace(/\s+/g, " ").trim() || "failed";
}
