import { createHash } from "node:crypto";
import path from "node:path";
import { appendEvent, seatPaths } from "../storage.js";
import {
  archiveCollab,
  getEntrySize,
  listCollabIds,
  readCollabManifest,
  readContextIndex,
  writeCollabManifest,
  writeContextIndex,
} from "./store.js";
import { formatContextFragment, truncateEntries } from "./strategies/index.js";
import type { AssembledContext, CollabContext, ContextEntry, ContextIndex, PullStrategy } from "./types.js";

export class CollabManager {
  constructor(private projectRoot: string = process.cwd()) {}

  async record(
    sessionId: string,
    seatId: string,
    entry: Omit<ContextEntry, "id">,
  ): Promise<ContextEntry> {
    const id = createHash("sha256")
      .update(`${sessionId}:${seatId}:${entry.kind}:${entry.createdAt}`)
      .digest("hex")
      .slice(0, 16);

    const fullEntry: ContextEntry = { id, ...entry };
    fullEntry.sizeBytes = await getEntrySize(fullEntry);

    const index = await readContextIndex(sessionId, seatId, this.projectRoot);
    index.entries.unshift(fullEntry);
    await writeContextIndex(sessionId, index, this.projectRoot);

    await appendEvent(
      sessionId,
      {
        type: "context.entry_recorded",
        seatId,
        entryId: id,
        kind: entry.kind,
        ts: new Date().toISOString(),
      },
      this.projectRoot,
    );

    return fullEntry;
  }

  async openCollab(sessionId: string, memberSeatIds: string[]): Promise<CollabContext> {
    const id = `collab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const collab: CollabContext = {
      id,
      sessionId,
      memberSeatIds: [...new Set(memberSeatIds)].sort(),
      entryIds: [],
      openedAt: new Date().toISOString(),
    };

    await writeCollabManifest(sessionId, collab, this.projectRoot);
    await appendEvent(
      sessionId,
      {
        type: "context.collab_opened",
        collabId: id,
        memberSeatIds: collab.memberSeatIds,
        ts: collab.openedAt,
      },
      this.projectRoot,
    );

    return collab;
  }

  async pinToCollab(
    sessionId: string,
    collabId: string,
    seatId: string,
    entryIds?: string[],
  ): Promise<void> {
    const collab = await readCollabManifest(sessionId, collabId, this.projectRoot);
    if (!collab) throw new Error(`Collab ${collabId} not found`);

    const index = await readContextIndex(sessionId, seatId, this.projectRoot);
    const toPinIds = entryIds ?? index.entries.slice(0, 5).map((e) => e.id);

    const newEntryIds = [...new Set([...collab.entryIds, ...toPinIds])];
    await writeCollabManifest(sessionId, { ...collab, entryIds: newEntryIds }, this.projectRoot);
  }

  async pull(input: {
    sessionId: string;
    seatId: string;
    collabId?: string;
    instruction: string;
    strategy?: PullStrategy;
  }): Promise<AssembledContext> {
    const entries: ContextEntry[] = [];

    if (input.collabId) {
      const collab = await readCollabManifest(input.sessionId, input.collabId, this.projectRoot);
      if (collab) {
        for (const memberId of collab.memberSeatIds) {
          const index = await readContextIndex(input.sessionId, memberId, this.projectRoot);
          const relevantEntries = index.entries.filter((e) => collab.entryIds.includes(e.id));
          entries.push(...relevantEntries);
        }
      }
    }

    const { kept, dropped } = await truncateEntries(entries, input.strategy);
    const promptFragment = await formatContextFragment(input.instruction, kept);

    return {
      promptFragment,
      sourcedEntryIds: kept.map((e) => e.id),
      droppedForSize: dropped,
    };
  }

  async closeCollab(sessionId: string, collabId: string): Promise<void> {
    const collab = await readCollabManifest(sessionId, collabId, this.projectRoot);
    if (!collab) return;

    await writeCollabManifest(
      sessionId,
      { ...collab, closedAt: new Date().toISOString() },
      this.projectRoot,
    );
    await archiveCollab(sessionId, collabId, this.projectRoot);
    await appendEvent(
      sessionId,
      {
        type: "context.collab_closed",
        collabId,
        ts: new Date().toISOString(),
      },
      this.projectRoot,
    );
  }

  async clearSeat(sessionId: string, seatId: string): Promise<void> {
    const index = await readContextIndex(sessionId, seatId, this.projectRoot);
    const clearedIndex: ContextIndex = {
      seatId,
      entries: [],
      updatedAt: new Date().toISOString(),
    };
    await writeContextIndex(sessionId, clearedIndex, this.projectRoot);

    const collabIds = await listCollabIds(sessionId, this.projectRoot);
    for (const collabId of collabIds) {
      const collab = await readCollabManifest(sessionId, collabId, this.projectRoot);
      if (!collab || collab.closedAt) continue;

      const seatEntryIds = new Set(index.entries.map((e) => e.id));
      const filteredEntryIds = collab.entryIds.filter((id) => !seatEntryIds.has(id));
      await writeCollabManifest(
        sessionId,
        { ...collab, entryIds: filteredEntryIds },
        this.projectRoot,
      );
    }

    await appendEvent(
      sessionId,
      {
        type: "context.seat_cleared",
        seatId,
        ts: new Date().toISOString(),
      },
      this.projectRoot,
    );
  }

  async getIndex(sessionId: string, seatId: string): Promise<ContextIndex> {
    return readContextIndex(sessionId, seatId, this.projectRoot);
  }

  async getCollab(sessionId: string, collabId: string): Promise<CollabContext | undefined> {
    return readCollabManifest(sessionId, collabId, this.projectRoot);
  }
}

export function createCollabManager(projectRoot?: string): CollabManager {
  return new CollabManager(projectRoot);
}
