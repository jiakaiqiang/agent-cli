import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { adapterFor } from "./adapters/index.js";
import { runCapture } from "./adapters/runner.js";
import { createCollabManager } from "./collab/index.js";
import { parseChangedFiles } from "./contextpack.js";
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
  const executionRoot = await resolveInstructionWorkspace(options.projectRoot, options.instruction);
  let assignment: Assignment | undefined;
  let workspacePath = executionRoot;
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
    if (executionRoot !== options.projectRoot) {
      const message = `AgentRoom: detected task workspace ${executionRoot}`;
      await appendTranscript(options.sessionId, options.seatId, `${message}\n`, options.projectRoot);
      await appendEvent(
        options.sessionId,
        { type: "activity.appended", seatId: options.seatId, text: message, ts: new Date().toISOString() },
        options.projectRoot,
      );
    }

    const workspace = await resolveExecutionWorkspace(executionRoot, fallbackWorktreePath, Boolean(options.allowDirty));
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

    const collabManager = createCollabManager(options.projectRoot);

    let collabId: string | undefined;
    if (options.sourceSeatIds.length > 0) {
      const collab = await collabManager.openCollab(options.sessionId, [
        options.seatId,
        ...options.sourceSeatIds,
      ]);
      collabId = collab.id;

      for (const sourceSeatId of options.sourceSeatIds) {
        await collabManager.pinToCollab(options.sessionId, collabId, sourceSeatId);
      }
    }

    const assembled = await collabManager.pull({
      sessionId: options.sessionId,
      seatId: options.seatId,
      collabId,
      instruction: options.instruction,
    });

    assignment = {
      id: assignmentId,
      sessionId: options.sessionId,
      targetSeatId: options.seatId,
      sourceSeatIds: options.sourceSeatIds,
      instruction: options.instruction,
      contextPack: {
        userInstruction: options.instruction,
        sourceSeats: [],
        artifacts: [],
      },
      assembledPrompt: assembled.promptFragment,
      controlMode: options.controlMode ?? "accept",
      status: "queued",
      createdAt,
    };

    const adapter = adapterFor(options.runner);
    for await (const event of adapter.run(assignment, {
      projectRoot: options.projectRoot,
      cwd: workspace.cwd,
      timeoutMs: options.timeoutMs ?? 30 * 60_000,
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

    const paths = seatPaths(options.sessionId, options.seatId, options.projectRoot);
    const changedFiles = parseChangedFiles(patch.stdout);

    await collabManager.record(options.sessionId, options.seatId, {
      seatId: options.seatId,
      kind: "summary",
      createdAt: new Date().toISOString(),
      sizeBytes: 0,
      refPath: paths.summary,
      meta: { changedFiles },
    });

    await collabManager.record(options.sessionId, options.seatId, {
      seatId: options.seatId,
      kind: "patch",
      createdAt: new Date().toISOString(),
      sizeBytes: 0,
      refPath: paths.patch,
      meta: { changedFiles, diffStat: stat.stdout },
    });

    if (collabId) {
      await collabManager.closeCollab(options.sessionId, collabId);
    }
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

async function resolveInstructionWorkspace(projectRoot: string, instruction: string): Promise<string> {
  for (const candidate of extractAbsolutePathCandidates(instruction)) {
    const directory = await existingDirectoryForPath(candidate);
    if (!directory) continue;
    const gitRoot = await gitTopLevel(directory);
    if (gitRoot) return gitRoot;
  }
  return projectRoot;
}

function extractAbsolutePathCandidates(value: string): string[] {
  const candidates = new Set<string>();
  const quotedPathPattern = /["'`](.*?(?:[A-Za-z]:[\\/]|\/).*?)["'`]/g;
  const windowsPathPattern = /[A-Za-z]:[\\/][^\s"'`<>|]+/g;
  const posixPathPattern = /(?<![\w.-])\/[^\s"'`<>|]+/g;

  for (const match of value.matchAll(quotedPathPattern)) {
    const candidate = match[1]?.trim();
    if (candidate) candidates.add(stripTrailingPathPunctuation(candidate));
  }
  for (const match of value.matchAll(windowsPathPattern)) {
    candidates.add(stripTrailingPathPunctuation(match[0]));
  }
  for (const match of value.matchAll(posixPathPattern)) {
    candidates.add(stripTrailingPathPunctuation(match[0]));
  }

  return [...candidates].filter(Boolean);
}

function stripTrailingPathPunctuation(value: string): string {
  return value.replace(/[),.;!?，。；！？）】]+$/u, "");
}

async function existingDirectoryForPath(candidate: string): Promise<string | undefined> {
  try {
    const resolved = path.resolve(candidate);
    const info = await stat(resolved);
    return info.isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    return undefined;
  }
}

async function gitTopLevel(cwd: string): Promise<string | undefined> {
  const result = await git(["rev-parse", "--show-toplevel"], cwd);
  if (result.exitCode !== 0) return undefined;
  const root = result.stdout.trim();
  return root ? path.resolve(root) : undefined;
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

function uniqueSeatIds(seatIds: string[]): string[] {
  return seatIds.filter((seatId, index, all) => seatId && all.indexOf(seatId) === index);
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
