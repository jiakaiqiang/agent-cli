export type RunnerType = "codex" | "claude" | "gemini";

export type SeatState = "idle" | "queued" | "running" | "done" | "failed" | "stopped";

export type RunnerProbe = {
  type: RunnerType;
  available: boolean;
  command: string;
  version?: string;
  versionExitCode?: number | null;
  promptExitCode?: number | null;
  supportsStreaming?: boolean;
  supportsStructuredOutput?: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
  durationMs: number;
  checkedAt: string;
};

export type RunnerInstance = {
  id: string;
  type: RunnerType;
  displayName: string;
  command: string;
  enabled: boolean;
  processId?: number;
  workspaceMode: "shared" | "worktree";
  worktreePath?: string;
};

export type SeatView = {
  id: string;
  runnerType: RunnerType;
  name: string;
  state: SeatState;
  stateText: string;
  currentTask?: string;
  currentAction?: string;
  changedFiles: number;
  runtimeMs: number;
  needsUser: false;
};

export type ActivityView = {
  ts: string;
  text: string;
};

export type FileChangeView = {
  path: string;
  changeType: "M" | "A" | "D";
};

export type ArtifactRef = {
  path: string;
  kind?: string;
};

export type DeskView = {
  seatId: string;
  title: string;
  currentTask?: string;
  currentAction?: string;
  activities: ActivityView[];
  files: FileChangeView[];
  artifacts: ArtifactRef[];
  summary?: string;
  error?: string;
};

export type ClassroomView = {
  session: {
    id: string;
    title: string;
    projectPath: string;
    branch?: string;
    startedAt: string;
    runtimeMs: number;
  };
  blackboard: {
    title: string;
  };
  seats: SeatView[];
  selectedSeatId?: string;
  desk?: DeskView;
};

export type SourceSeatContext = {
  seatId: string;
  summary?: string;
  patch?: string;
  changedFiles: string[];
  artifacts: ArtifactRef[];
};

export type ContextPack = {
  userInstruction: string;
  sourceSeats: SourceSeatContext[];
  artifacts: ArtifactRef[];
};

export type Assignment = {
  id: string;
  sessionId: string;
  targetSeatId: string;
  sourceSeatIds: string[];
  instruction: string;
  contextPack: ContextPack;
  status: "queued" | "running" | "done" | "failed" | "stopped";
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type ClassroomCommand =
  | { type: "select_seat"; seatId: string }
  | { type: "dispatch"; targetSeatId: string; instruction: string; sourceSeatIds: string[] }
  | { type: "stop_seat"; seatId: string };

export type AgentRoomEvent =
  | { type: "seat.state_changed"; seatId: string; state: SeatState; ts: string }
  | { type: "activity.appended"; seatId: string; text: string; ts: string }
  | { type: "file.changed"; seatId: string; path: string; changeType: "M" | "A" | "D"; ts: string }
  | { type: "assignment.started"; assignmentId: string; seatId: string; ts: string }
  | { type: "assignment.completed"; assignmentId: string; seatId: string; ts: string }
  | { type: "assignment.failed"; assignmentId: string; seatId: string; error: string; ts: string };

export type SeatStateFile = {
  seatId: string;
  runnerType: RunnerType;
  state: SeatState;
  currentTask?: string;
  processId?: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  updatedAt: string;
};

export type SessionInfo = {
  id: string;
  title: string;
  projectPath: string;
  startedAt: string;
};

