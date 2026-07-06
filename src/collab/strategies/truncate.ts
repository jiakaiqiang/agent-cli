import type { ContextEntry, PullStrategy } from "../types.js";
import { readEntryContent } from "../store.js";

const defaultStrategy: Required<PullStrategy> = {
  maxPatchFiles: 10,
  maxPatchBytesPerFile: 5 * 1024,
  maxTranscriptLines: 30,
};

export async function truncateEntries(
  entries: ContextEntry[],
  strategy: PullStrategy = {},
): Promise<{ kept: ContextEntry[]; dropped: string[] }> {
  const opts = { ...defaultStrategy, ...strategy };
  const kept: ContextEntry[] = [];
  const dropped: string[] = [];

  for (const entry of entries) {
    if (entry.kind === "patch") {
      const truncated = await truncatePatch(entry, opts);
      if (truncated) {
        kept.push(truncated);
      } else {
        dropped.push(entry.id);
      }
    } else if (entry.kind === "transcript-tail") {
      const truncated = await truncateTranscript(entry, opts);
      kept.push(truncated);
    } else {
      kept.push(entry);
    }
  }

  return { kept, dropped };
}

async function truncatePatch(
  entry: ContextEntry,
  opts: Required<PullStrategy>,
): Promise<ContextEntry | null> {
  const content = await readEntryContent(entry);
  const files = parsePatchFiles(content);

  if (files.length === 0) {
    return entry;
  }

  if (files.length <= opts.maxPatchFiles) {
    const truncatedFiles = files.map((file) => {
      if (file.content.length <= opts.maxPatchBytesPerFile) {
        return file.content;
      }
      return `${file.header}\n... (truncated, ${file.content.length} bytes total)`;
    });
    const truncatedContent = truncatedFiles.join("\n\n");

    return {
      ...entry,
      refPath: `${entry.refPath}.truncated`,
      meta: {
        ...entry.meta,
        diffStat: entry.meta?.diffStat || "(diffstat unavailable)",
      },
    };
  }

  const diffStat = entry.meta?.diffStat || "(diffstat unavailable)";
  return {
    ...entry,
    refPath: `${entry.refPath}.diffstat-only`,
    meta: {
      ...entry.meta,
      diffStat,
    },
  };
}

async function truncateTranscript(
  entry: ContextEntry,
  opts: Required<PullStrategy>,
): Promise<ContextEntry> {
  const content = await readEntryContent(entry);
  const lines = content.split(/\r?\n/).filter(Boolean);

  if (lines.length <= opts.maxTranscriptLines) {
    return entry;
  }

  return {
    ...entry,
    meta: {
      ...entry.meta,
    },
  };
}

type PatchFile = {
  header: string;
  content: string;
};

function parsePatchFiles(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  const lines = patch.split(/\r?\n/);
  let currentFile: PatchFile | null = null;

  for (const line of lines) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match) {
      if (currentFile) files.push(currentFile);
      currentFile = { header: line, content: line };
    } else if (currentFile) {
      currentFile.content += `\n${line}`;
    }
  }

  if (currentFile) files.push(currentFile);
  return files;
}
