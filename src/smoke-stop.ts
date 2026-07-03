import { adapterFor } from "./adapters/index.js";
import { prepareWorktree } from "./assignment.js";
import { buildContextPack } from "./contextpack.js";
import { createSeat, createSession, readSeatState, worktreesDir } from "./storage.js";
import type { Assignment } from "./types.js";
import path from "node:path";

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const session = await createSession({ title: "smoke stop", projectPath: projectRoot });
  const seatId = "codex-1";
  await createSeat(session.id, {
    seatId,
    runnerType: "codex",
    state: "queued",
    currentTask: "agentroom-sleep",
    updatedAt: new Date().toISOString(),
  });
  const worktreePath = path.join(worktreesDir(projectRoot), session.id, `${seatId}-${Date.now()}`);
  await prepareWorktree(projectRoot, worktreePath, true);
  const contextPack = await buildContextPack(session.id, "agentroom-sleep", [], projectRoot);
  const assignment: Assignment = {
    id: `assign_${Date.now()}`,
    sessionId: session.id,
    targetSeatId: seatId,
    sourceSeatIds: [],
    instruction: "agentroom-sleep",
    contextPack,
    status: "queued",
    createdAt: new Date().toISOString(),
  };

  const adapter = adapterFor("codex");
  const runPromise = (async () => {
    for await (const _event of adapter.run(assignment, { projectRoot, cwd: worktreePath, timeoutMs: 60_000 })) {
      // Events are persisted by the adapter.
    }
  })();

  await delay(800);
  await adapter.stop(seatId);
  await runPromise;

  const state = await readSeatState(session.id, seatId, projectRoot);
  if (state?.state !== "stopped") {
    throw new Error(`停止烟测失败：期望状态为 stopped，实际为 ${state?.state ?? "缺失"}。`);
  }

  console.log(`会话：${session.id}`);
  console.log("停止烟测通过：运行中的模拟 runner 最终状态为 stopped。");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
