export type ContextEntryKind = "summary" | "patch" | "transcript-tail" | "artifact";

export type ContextEntry = {
  id: string;
  seatId: string;
  kind: ContextEntryKind;
  createdAt: string;
  sizeBytes: number;
  refPath: string;
  meta?: {
    changedFiles?: string[];
    diffStat?: string;
  };
};

export type ContextIndex = {
  seatId: string;
  entries: ContextEntry[];
  updatedAt: string;
};

export type CollabContext = {
  id: string;
  sessionId: string;
  memberSeatIds: string[];
  entryIds: string[];
  openedAt: string;
  closedAt?: string;
};

export type AssembledContext = {
  promptFragment: string;
  sourcedEntryIds: string[];
  droppedForSize: string[];
};

export type PullStrategy = {
  maxPatchFiles?: number;
  maxPatchBytesPerFile?: number;
  maxTranscriptLines?: number;
};

export type CollabManifest = CollabContext;
