export const contextClearTranscriptPrefix = "AgentRoom: context cleared";

export function contextClearTranscriptLine(ts = new Date().toISOString()): string {
  return `${contextClearTranscriptPrefix} at ${ts}`;
}

export function trimTranscriptAfterContextClear(lines: string[]): string[] {
  let markerIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim().startsWith(contextClearTranscriptPrefix)) {
      markerIndex = index;
      break;
    }
  }
  return markerIndex >= 0 ? lines.slice(markerIndex + 1) : lines;
}
