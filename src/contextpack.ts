import { readdir } from "node:fs/promises";
import path from "node:path";
import { readPatch, readSummary, seatPaths } from "./storage.js";
import type { ArtifactRef, ContextPack, SourceSeatContext } from "./types.js";

export async function buildContextPack(
  sessionId: string,
  instruction: string,
  sourceSeatIds: string[],
  projectRoot = process.cwd(),
): Promise<ContextPack> {
  const sourceSeats: SourceSeatContext[] = [];
  for (const seatId of sourceSeatIds) {
    const summary = await readSummary(sessionId, seatId, projectRoot);
    const patch = await readPatch(sessionId, seatId, projectRoot);
    const artifacts = await listArtifacts(sessionId, seatId, projectRoot);
    sourceSeats.push({
      seatId,
      summary,
      patch,
      changedFiles: parseChangedFiles(patch ?? ""),
      artifacts,
    });
  }

  return {
    userInstruction: instruction,
    sourceSeats,
    artifacts: sourceSeats.flatMap((seat) => seat.artifacts),
  };
}

export function formatContextPack(pack: ContextPack): string {
  if (pack.sourceSeats.length === 0) {
    return `用户指令：\n${pack.userInstruction}`;
  }

  const sources = pack.sourceSeats
    .map((seat) => {
      const changedFiles = seat.changedFiles.length > 0 ? seat.changedFiles.map((file) => `- ${file}`).join("\n") : "- 无";
      return [
        `来源座位：${seat.seatId}`,
        "摘要：",
        seat.summary?.trim() || "（缺少摘要）",
        "变更文件：",
        changedFiles,
        "补丁：",
        seat.patch?.trim() || "（缺少补丁）",
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return [
    "用户指令：",
    pack.userInstruction,
    "",
    "引用的来源座位：",
    sources,
  ].join("\n");
}

export function parseChangedFiles(patch: string): string[] {
  const files = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match) files.add(match[2]);
  }
  return [...files].sort();
}

async function listArtifacts(sessionId: string, seatId: string, projectRoot: string): Promise<ArtifactRef[]> {
  const artifactsDir = seatPaths(sessionId, seatId, projectRoot).artifacts;
  try {
    const entries = await readdir(artifactsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => ({ path: path.join(artifactsDir, entry.name) }));
  } catch {
    return [];
  }
}
