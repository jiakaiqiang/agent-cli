import type { ContextEntry } from "../types.js";
import { readEntryContent } from "../store.js";

export async function formatContextFragment(
  instruction: string,
  entries: ContextEntry[],
): Promise<string> {
  if (entries.length === 0) {
    return `用户指令：\n${instruction}`;
  }

  const seatGroups = groupEntriesBySeat(entries);
  const sources: string[] = [];

  for (const [seatId, seatEntries] of Object.entries(seatGroups)) {
    const summary = seatEntries.find((e) => e.kind === "summary");
    const patch = seatEntries.find((e) => e.kind === "patch");
    const transcript = seatEntries.find((e) => e.kind === "transcript-tail");

    const changedFiles = patch?.meta?.changedFiles ?? [];
    const changedFilesList = changedFiles.length > 0 ? changedFiles.map((f) => `- ${f}`).join("\n") : "- 无";

    const transcriptContent = transcript ? await readEntryContent(transcript) : "";
    const transcriptLines = transcriptContent
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => `- ${line}`);
    const transcriptTail = transcriptLines.length > 0 ? transcriptLines.join("\n") : "- 无";

    const summaryContent = summary ? await readEntryContent(summary) : "";
    const patchContent = patch ? await readEntryContent(patch) : "";

    sources.push(
      [
        `来源座位：${seatId}`,
        "最近问答/输出：",
        transcriptTail,
        "摘要：",
        summaryContent.trim() || "（缺少摘要）",
        "变更文件：",
        changedFilesList,
        "补丁：",
        patchContent.trim() || "（缺少补丁）",
      ].join("\n"),
    );
  }

  return ["用户指令：", instruction, "", "引用的来源座位：", sources.join("\n\n---\n\n")].join("\n");
}

function groupEntriesBySeat(entries: ContextEntry[]): Record<string, ContextEntry[]> {
  const groups: Record<string, ContextEntry[]> = {};
  for (const entry of entries) {
    if (!groups[entry.seatId]) groups[entry.seatId] = [];
    groups[entry.seatId].push(entry);
  }
  return groups;
}
