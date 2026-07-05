import { access, appendFile, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentControlMode, AgentRoomEvent, RunnerType, SeatStateFile, SessionInfo } from "./types.js";

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

export type RoomSettings = {
  seats: Array<{
    seatId: string;
    runnerType: RunnerType;
    controlMode?: AgentControlMode;
  }>;
  updatedAt: string;
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

export function settingsFile(projectRoot = process.cwd()): string {
  return path.join(agentroomDir(projectRoot), "settings.json");
}

export function globalSettingsFile(): string {
  return path.join(os.homedir(), ".agentroom", "settings.json");
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

export async function readRoomSettings(projectRoot = process.cwd()): Promise<RoomSettings | undefined> {
  const projectSettings = await readSettingsFile(settingsFile(projectRoot));
  if (projectSettings) return projectSettings;
  return readSettingsFile(globalSettingsFile());
}

export async function writeRoomSettings(settings: RoomSettings, projectRoot = process.cwd()): Promise<void> {
  await writeJson(settingsFile(projectRoot), settings);
  try {
    await writeJson(globalSettingsFile(), settings);
  } catch {
    // Project settings are authoritative; global settings are only a convenience fallback.
  }
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

export async function watchTranscriptStream(sessionId: string, seatId: string, projectRoot = process.cwd()): Promise<string> {
  const file = seatPaths(sessionId, seatId, projectRoot).transcript;
  if (!(await exists(file))) return "";
  const content = await readFile(file, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  return lines.slice(-10).join("\n");
}

export async function writeSeatState(sessionId: string, state: SeatStateFile, projectRoot = process.cwd()): Promise<void> {
  const paths = seatPaths(sessionId, state.seatId, projectRoot);
  await mkdir(paths.root, { recursive: true });
  await writeJson(paths.state, state);
}

export async function readSeatState(sessionId: string, seatId: string, projectRoot = process.cwd()): Promise<SeatStateFile | undefined> {
  const file = seatPaths(sessionId, seatId, projectRoot).state;
  if (!(await exists(file))) return undefined;
  const raw = await readFile(file, "utf8");
  try {
    return JSON.parse(raw) as SeatStateFile;
  } catch {
    return undefined;
  }
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

const writeChain = new Map<string, Promise<void>>();

export async function writeJson(file: string, data: unknown): Promise<void> {
  const previous = writeChain.get(file) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await rename(tmp, file);
    });
  writeChain.set(file, next);
  try {
    await next;
  } finally {
    if (writeChain.get(file) === next) writeChain.delete(file);
  }
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

async function readSettingsFile(file: string): Promise<RoomSettings | undefined> {
  if (!(await exists(file))) return undefined;
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<RoomSettings>;
    if (!Array.isArray(parsed.seats)) return undefined;
    const seats = parsed.seats
      .filter((seat): seat is { seatId: string; runnerType: RunnerType; controlMode?: AgentControlMode } => {
        return (
          typeof seat?.seatId === "string" &&
          (seat.runnerType === "codex" || seat.runnerType === "claude" || seat.runnerType === "gemini")
        );
      })
      .map((seat) => ({
        ...seat,
        controlMode: parseControlMode(seat.controlMode),
      }))
      .filter((seat, index, all) => all.findIndex((candidate) => candidate.seatId === seat.seatId) === index);
    if (seats.length === 0) return undefined;
    return {
      seats,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

function parseControlMode(value: unknown): AgentControlMode | undefined {
  return value === "plan" || value === "accept" || value === "full" ? value : undefined;
}
