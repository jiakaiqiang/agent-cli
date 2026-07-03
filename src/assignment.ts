import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { adapterFor } from "./adapters/index.js";
import { runCapture } from "./adapters/runner.js";
import { buildContextPack } from "./contextpack.js";
import {
  appendEvent,
  createSeat,
  seatPaths,
  worktreesDir,
  writePatch,
  writeSeatState,
  writeSummary,
} from "./storage.js";
import type { Assignment, RunnerType } from "./types.js";

export type RunSeatAssignmentOptions = {
  projectRoot: string;
  sessionId: string;
  runner: RunnerType;
  seatId: string;
  instruction: string;
  sourceSeatIds: string[];
  timeoutMs?: number;
  allowDirty?: boolean;
};

export type RunSeatAssignmentResult = {
  assignment: Assignment;
  seatPath: string;
  worktreePath: string;
};

export async function runSeatAssignment(options: RunSeatAssignmentOptions): Promise<RunSeatAssignmentResult> {
  const createdAt = new Date().toISOString();
  await createSeat(
    options.sessionId,
    {
      seatId: options.seatId,
      runnerType: options.runner,
      state: "queued",
      currentTask: options.instruction,
      updatedAt: createdAt,
    },
    options.projectRoot,
  );
  await appendEvent(
    options.sessionId,
    { type: "seat.state_changed", seatId: options.seatId, state: "queued", ts: createdAt },
    options.projectRoot,
  );

  const worktreePath = path.join(worktreesDir(options.projectRoot), options.sessionId, `${options.seatId}-${Date.now()}`);
  await prepareWorktree(options.projectRoot, worktreePath, Boolean(options.allowDirty));

  const contextPack = await buildContextPack(options.sessionId, options.instruction, options.sourceSeatIds, options.projectRoot);
  const assignment: Assignment = {
    id: `assign_${Date.now()}`,
    sessionId: options.sessionId,
    targetSeatId: options.seatId,
    sourceSeatIds: options.sourceSeatIds,
    instruction: options.instruction,
    contextPack,
    status: "queued",
    createdAt,
  };

  try {
    const adapter = adapterFor(options.runner);
    for await (const _event of adapter.run(assignment, {
      projectRoot: options.projectRoot,
      cwd: worktreePath,
      timeoutMs: options.timeoutMs ?? 10 * 60_000,
    })) {
      // Adapter persists events as they occur.
    }

    const patch = await git(["diff"], worktreePath);
    const stat = await git(["diff", "--stat"], worktreePath);
    await writePatch(options.sessionId, options.seatId, patch.stdout, options.projectRoot);

    const summary = await collectSummary(worktreePath, options.instruction, stat.stdout, patch.stdout);
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
        error: message,
        updatedAt: ts,
      },
      options.projectRoot,
    );
    await appendEvent(options.sessionId, { type: "assignment.failed", assignmentId: assignment.id, seatId: options.seatId, error: message, ts }, options.projectRoot);
    await appendEvent(options.sessionId, { type: "seat.state_changed", seatId: options.seatId, state: "failed", ts }, options.projectRoot);
    throw error;
  }

  return {
    assignment,
    seatPath: seatPaths(options.sessionId, options.seatId, options.projectRoot).root,
    worktreePath,
  };
}

export async function prepareWorktree(projectRoot: string, worktreePath: string, allowDirty = false): Promise<void> {
  await mkdir(path.dirname(worktreePath), { recursive: true });
  const dirty = await git(["status", "--porcelain"], projectRoot);
  if (!allowDirty && dirty.stdout.trim()) {
    throw new Error("主工作区存在未提交改动，已拒绝创建 corridor worktree。如只是本地实验，可传入 --allow-dirty。");
  }
  const branchName = `agentroom-${path.basename(path.dirname(worktreePath))}-${path.basename(worktreePath)}-${Date.now()}`;
  const result = await git(["worktree", "add", "-b", branchName, worktreePath, "HEAD"], projectRoot);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "创建 git worktree 失败。");
  }
}

export async function collectSummary(worktreePath: string, task: string, diffStat: string, patch: string): Promise<string> {
  const summaryFile = path.join(worktreePath, "AGENTROOM_SUMMARY.md");
  try {
    return await readFile(summaryFile, "utf8");
  } catch {
    const changedFiles = parseDiffStatFiles(diffStat);
    return [
      "---",
      `summary: ${JSON.stringify(`任务的兜底摘要：${task}`)}`,
      "changed_files:",
      ...(changedFiles.length ? changedFiles.map((file) => `  - ${file}`) : ["  []"]),
      "tests: []",
      "claims: []",
      "---",
      "",
      "AgentRoom 生成的兜底摘要。",
      "",
      "Diff 统计：",
      diffStat.trim() || "（没有 diff 统计）",
      "",
      patch.trim() ? "补丁已写入 patch.diff。" : "没有产生补丁。",
    ].join("\n");
  }
}

function parseDiffStatFiles(diffStat: string): string[] {
  return diffStat
    .split(/\r?\n/)
    .map((line) => line.split("|")[0]?.trim())
    .filter((value): value is string => Boolean(value && !value.includes("files changed")));
}

async function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return runCapture({ command: "git", args }, cwd, 60_000);
}
