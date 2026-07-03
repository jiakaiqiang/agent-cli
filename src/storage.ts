import { access, appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRoomEvent, SeatStateFile, SessionInfo } from "./types.js";

export type SessionPaths = {
  root: string;
  events: string;
  classroom: string;
  seats: string;
};

export type SeatPaths = {
  root: string;
  state: string;
  transcript: string;
  summary: string;
  patch: string;
  artifacts: string;
};

export function agentroomDir(projectRoot = process.cwd()): string {
  return path.join(projectRoot, ".agentroom");
}

export function sessionsDir(projectRoot = process.cwd()): string {
  return path.join(agentroomDir(projectRoot), "sessions");
}

export function probeDir(projectRoot = process.cwd()): string {
  return path.join(agentroomDir(projectRoot), "probe");
}

export function worktreesDir(projectRoot = process.cwd()): string {
  return path.join(agentroomDir(projectRoot), "worktrees");
}

export function createSessionId(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    "sess",
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
    String(date.getMilliseconds()).padStart(3, "0"),
  ].join("_");
}

export function sessionPaths(sessionId: string, projectRoot = process.cwd()): SessionPaths {
  const root = path.join(sessionsDir(projectRoot), sessionId);
  return {
    root,
    events: path.join(root, "events.jsonl"),
    classroom: path.join(root, "classroom.json"),
    seats: path.join(root, "seats"),
  };
}

export function seatPaths(sessionId: string, seatId: string, projectRoot = process.cwd()): SeatPaths {
  const root = path.join(sessionPaths(sessionId, projectRoot).seats, seatId);
  return {
    root,
    state: path.join(root, "state.json"),
    transcript: path.join(root, "transcript.log"),
    summary: path.join(root, "summary.md"),
    patch: path.join(root, "patch.diff"),
    artifacts: path.join(root, "artifacts"),
  };
}

export async function createSession(info: Omit<SessionInfo, "id" | "startedAt"> & Partial<Pick<SessionInfo, "id" | "startedAt">>, projectRoot = process.cwd()): Promise<SessionInfo> {
  const session: SessionInfo = {
    id: info.id ?? createSessionId(),
    title: info.title,
    projectPath: info.projectPath,
    startedAt: info.startedAt ?? new Date().toISOString(),
  };
  const paths = sessionPaths(session.id, projectRoot);
  await mkdir(paths.seats, { recursive: true });
  await writeJson(paths.classroom, session);
  await ensureFile(paths.events);
  return session;
}

export async function createSeat(sessionId: string, state: SeatStateFile, projectRoot = process.cwd()): Promise<SeatPaths> {
  const paths = seatPaths(sessionId, state.seatId, projectRoot);
  await mkdir(paths.artifacts, { recursive: true });
  await writeSeatState(sessionId, state, projectRoot);
  await ensureFile(paths.transcript);
  await ensureFile(paths.summary);
  await ensureFile(paths.patch);
  return paths;
}

export async function appendEvent(sessionId: string, event: AgentRoomEvent, projectRoot = process.cwd()): Promise<void> {
  await mkdir(sessionPaths(sessionId, projectRoot).root, { recursive: true });
  await appendFile(sessionPaths(sessionId, projectRoot).events, `${JSON.stringify(event)}\n`, "utf8");
}

export async function readEvents(sessionId: string, projectRoot = process.cwd()): Promise<AgentRoomEvent[]> {
  const file = sessionPaths(sessionId, projectRoot).events;
  if (!(await exists(file))) return [];
  const content = await readFile(file, "utf8");
  const events: AgentRoomEvent[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as AgentRoomEvent);
    } catch {
      events.push({
        type: "activity.appended",
        seatId: "system",
        text: `Skipped corrupt events.jsonl line ${index + 1}`,
        ts: new Date().toISOString(),
      });
    }
  }
  return events;
}

export async function appendTranscript(sessionId: string, seatId: string, text: string, projectRoot = process.cwd()): Promise<void> {
  const paths = seatPaths(sessionId, seatId, projectRoot);
  await mkdir(paths.root, { recursive: true });
  await appendFile(paths.transcript, text, "utf8");
}

export async function readTranscriptTail(sessionId: string, seatId: string, lineCount = 20, projectRoot = process.cwd()): Promise<string[]> {
  const file = seatPaths(sessionId, seatId, projectRoot).transcript;
  if (!(await exists(file))) return [];
  const lines = (await readFile(file, "utf8")).split(/\r?\n/).filter(Boolean);
  return lines.slice(-lineCount);
}

export async function writeSeatState(sessionId: string, state: SeatStateFile, projectRoot = process.cwd()): Promise<void> {
  const paths = seatPaths(sessionId, state.seatId, projectRoot);
  await mkdir(paths.root, { recursive: true });
  await writeJson(paths.state, state);
}

export async function readSeatState(sessionId: string, seatId: string, projectRoot = process.cwd()): Promise<SeatStateFile | undefined> {
  const file = seatPaths(sessionId, seatId, projectRoot).state;
  if (!(await exists(file))) return undefined;
  return JSON.parse(await readFile(file, "utf8")) as SeatStateFile;
}

export async function writeSummary(sessionId: string, seatId: string, summary: string, projectRoot = process.cwd()): Promise<void> {
  await writeText(seatPaths(sessionId, seatId, projectRoot).summary, summary);
}

export async function readSummary(sessionId: string, seatId: string, projectRoot = process.cwd()): Promise<string | undefined> {
  return readTextIfExists(seatPaths(sessionId, seatId, projectRoot).summary);
}

export async function writePatch(sessionId: string, seatId: string, patch: string, projectRoot = process.cwd()): Promise<void> {
  await writeText(seatPaths(sessionId, seatId, projectRoot).patch, patch);
}

export async function readPatch(sessionId: string, seatId: string, projectRoot = process.cwd()): Promise<string | undefined> {
  return readTextIfExists(seatPaths(sessionId, seatId, projectRoot).patch);
}

export async function listSessionIds(projectRoot = process.cwd()): Promise<string[]> {
  const dir = sessionsDir(projectRoot);
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export async function findLatestSessionId(projectRoot = process.cwd()): Promise<string | undefined> {
  const ids = await listSessionIds(projectRoot);
  return ids.at(-1);
}

export async function listSeatIds(sessionId: string, projectRoot = process.cwd()): Promise<string[]> {
  const dir = sessionPaths(sessionId, projectRoot).seats;
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function writeText(file: string, data: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data, "utf8");
}

export async function readTextIfExists(file: string): Promise<string | undefined> {
  if (!(await exists(file))) return undefined;
  return readFile(file, "utf8");
}

export async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function ensureFile(file: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  if (await exists(file)) return;
  await writeFile(file, "", "utf8");
}

export async function fileSize(file: string): Promise<number> {
  if (!(await exists(file))) return 0;
  return (await stat(file)).size;
}
