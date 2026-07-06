import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { exists, sessionPaths, seatPaths, writeJson } from "../storage.js";
import type { CollabContext, CollabManifest, ContextEntry, ContextIndex } from "./types.js";

export function contextIndexPath(sessionId: string, seatId: string, projectRoot = process.cwd()): string {
  return path.join(seatPaths(sessionId, seatId, projectRoot).root, "context-index.json");
}

export function collabsDir(sessionId: string, projectRoot = process.cwd()): string {
  return path.join(sessionPaths(sessionId, projectRoot).root, "collabs");
}

export function collabManifestPath(sessionId: string, collabId: string, projectRoot = process.cwd()): string {
  return path.join(collabsDir(sessionId, projectRoot), collabId, "manifest.json");
}

export function collabArchiveDir(sessionId: string, projectRoot = process.cwd()): string {
  return path.join(collabsDir(sessionId, projectRoot), "archive");
}

export async function readContextIndex(sessionId: string, seatId: string, projectRoot = process.cwd()): Promise<ContextIndex> {
  const file = contextIndexPath(sessionId, seatId, projectRoot);
  if (!(await exists(file))) {
    return {
      seatId,
      entries: [],
      updatedAt: new Date().toISOString(),
    };
  }
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as ContextIndex;
  } catch {
    return {
      seatId,
      entries: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function writeContextIndex(sessionId: string, index: ContextIndex, projectRoot = process.cwd()): Promise<void> {
  const file = contextIndexPath(sessionId, index.seatId, projectRoot);
  await writeJson(file, { ...index, updatedAt: new Date().toISOString() });
}

export async function readCollabManifest(sessionId: string, collabId: string, projectRoot = process.cwd()): Promise<CollabManifest | undefined> {
  const file = collabManifestPath(sessionId, collabId, projectRoot);
  if (!(await exists(file))) return undefined;
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as CollabManifest;
  } catch {
    return undefined;
  }
}

export async function writeCollabManifest(sessionId: string, manifest: CollabManifest, projectRoot = process.cwd()): Promise<void> {
  const file = collabManifestPath(sessionId, manifest.id, projectRoot);
  await mkdir(path.dirname(file), { recursive: true });
  await writeJson(file, manifest);
}

export async function listCollabIds(sessionId: string, projectRoot = process.cwd()): Promise<string[]> {
  const dir = collabsDir(sessionId, projectRoot);
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== "archive")
    .map((entry) => entry.name)
    .sort();
}

export async function archiveCollab(sessionId: string, collabId: string, projectRoot = process.cwd()): Promise<void> {
  const sourceDir = path.join(collabsDir(sessionId, projectRoot), collabId);
  const archiveBase = collabArchiveDir(sessionId, projectRoot);
  await mkdir(archiveBase, { recursive: true });
  const targetDir = path.join(archiveBase, `${collabId}_${Date.now()}`);

  const { rename } = await import("node:fs/promises");
  await rename(sourceDir, targetDir);
}

export async function getEntrySize(entry: ContextEntry): Promise<number> {
  try {
    const stats = await stat(entry.refPath);
    return stats.size;
  } catch {
    return 0;
  }
}

export async function readEntryContent(entry: ContextEntry): Promise<string> {
  try {
    return await readFile(entry.refPath, "utf8");
  } catch {
    return "";
  }
}
