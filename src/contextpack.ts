import { readdir } from "node:fs/promises";
import path from "node:path";
import { trimTranscriptAfterContextClear } from "./context-control.js";
import { readPatch, readSummary, readTranscriptTail, seatPaths } from "./storage.js";
import type { ArtifactRef, ContextPack, SourceSeatContext } from "./types.js";

const contextTranscriptLineCount = 30;
const contextTranscriptLineMaxLength = 240;

export async function buildContextPack(
  sessionId: string,
  instruction: string,
  sourceSeatIds: string[],
  projectRoot = process.cwd(),
): Promise<ContextPack> {
  const sourceSeats: SourceSeatContext[] = [];
  for (const seatId of uniqueSeatIds(sourceSeatIds)) {
    const summary = await readSummary(sessionId, seatId, projectRoot);
    const patch = await readPatch(sessionId, seatId, projectRoot);
    const transcriptTail = sanitizeTranscriptTail(
      trimTranscriptAfterContextClear(await readTranscriptTail(sessionId, seatId, contextTranscriptLineCount, projectRoot)),
      instruction,
    );
    const artifacts = await listArtifacts(sessionId, seatId, projectRoot);
    sourceSeats.push({
      seatId,
      summary,
      patch,
      transcriptTail,
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
      const transcriptTail = seat.transcriptTail?.length
        ? seat.transcriptTail.map((line) => `- ${line}`).join("\n")
        : "- 无";
      return [
        `来源座位：${seat.seatId}`,
        "最近问答/输出：",
        transcriptTail,
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

function uniqueSeatIds(seatIds: string[]): string[] {
  return seatIds.filter((seatId, index, all) => seatId && all.indexOf(seatId) === index);
}

function sanitizeTranscriptTail(lines: string[], instruction: string): string[] {
  const currentUserLine = `User: ${instruction}`.trim();
  return lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line, index, all) => !(line === currentUserLine && index === all.length - 1))
    .map((line) => (line.length <= contextTranscriptLineMaxLength ? line : `${line.slice(0, contextTranscriptLineMaxLength - 3)}...`));
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
