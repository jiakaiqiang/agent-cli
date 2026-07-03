import { pathToFileURL } from "node:url";
import { findLatestSessionId } from "./storage.js";
import { recoverSession } from "./recovery.js";

export async function runRecover(sessionIdArg?: string): Promise<void> {
  const sessionId = sessionIdArg ?? (await findLatestSessionId());
  if (!sessionId) {
    console.log("没有找到可恢复的会话。");
    return;
  }
  const count = await recoverSession(sessionId);
  console.log(`已在 ${sessionId} 中恢复 ${count} 个过期座位。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRecover(process.argv[2]).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
