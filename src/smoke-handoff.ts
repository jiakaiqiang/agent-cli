import { runSeatAssignment } from "./assignment.js";
import { createSession, readTranscriptTail, seatPaths } from "./storage.js";

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const session = await createSession({
    title: "smoke handoff",
    projectPath: projectRoot,
  });

  const first = await runSeatAssignment({
    projectRoot,
    sessionId: session.id,
    runner: "codex",
    seatId: "codex-1",
    instruction: "模拟修改 README",
    sourceSeatIds: [],
    allowDirty: true,
  });

  const second = await runSeatAssignment({
    projectRoot,
    sessionId: session.id,
    runner: "claude",
    seatId: "claude-1",
    instruction: "审查 @codex#1 并指出被修改的文件",
    sourceSeatIds: ["codex-1"],
    allowDirty: true,
  });

  const transcript = await readTranscriptTail(session.id, "claude-1", 20, projectRoot);
  const referencedPatch = transcript.some((line) => line.includes("已审查来源补丁：README.md"));
  if (!referencedPatch) {
    throw new Error("交接烟测失败：审查座位的 transcript 没有引用来源 README.md 补丁。");
  }

  console.log(`会话：${session.id}`);
  console.log(`第一座位目录：${first.seatPath}`);
  console.log(`第二座位目录：${second.seatPath}`);
  console.log(`审查摘要：${seatPaths(session.id, "claude-1", projectRoot).summary}`);
  console.log("交接烟测通过：审查座位引用了来源补丁中的 README.md。");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
