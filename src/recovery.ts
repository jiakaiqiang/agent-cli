import { appendEvent, listSeatIds, readSeatState, writeSeatState } from "./storage.js";

export async function recoverSession(sessionId: string, projectRoot = process.cwd()): Promise<number> {
  const seatIds = await listSeatIds(sessionId, projectRoot);
  let recovered = 0;
  for (const seatId of seatIds) {
    const state = await readSeatState(sessionId, seatId, projectRoot);
    if (!state || state.state !== "running") continue;
    if (state.processId && isProcessAlive(state.processId)) continue;

    const ts = new Date().toISOString();
    const error = state.processId
      ? `恢复过期运行中座位：进程 ${state.processId} 已不存在。`
      : "恢复过期运行中座位：没有记录进程 ID。";
    await writeSeatState(
      sessionId,
      {
        ...state,
        state: "failed",
        error,
        finishedAt: ts,
        updatedAt: ts,
      },
      projectRoot,
    );
    await appendEvent(sessionId, { type: "assignment.failed", assignmentId: "recovery", seatId, error, ts }, projectRoot);
    await appendEvent(sessionId, { type: "seat.state_changed", seatId, state: "failed", ts }, projectRoot);
    recovered += 1;
  }
  return recovered;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
