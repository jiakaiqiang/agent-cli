# AgentRoom Architecture

## Technical Stack

MVP stack:

- Language: TypeScript
- Runtime: Node.js
- CLI parser: commander or clipanion
- TUI: Ink + React
- Process execution: Node `child_process` or `execa`
- Config: YAML and JSON
- Storage: filesystem + JSONL
- Database: none in MVP

The MVP should avoid a database. Files are easier to inspect, copy, debug, and open source.

## Top-Level Modules

```text
packages/
  cli/
    command entrypoint and TUI launcher
  core/
    classroom, assignments, runners, registry, memory, hooks
  tui/
    Ink UI components
  adapters/
    codex, claude, gemini runner adapters
  builtin/
    default agents, skills, hooks, flows
```

If using a single package first, preserve the same internal module boundaries under `src/`.

## Core Concepts

### Runner Type

A supported tool type:

```ts
type RunnerType = "codex" | "claude" | "gemini";
```

### Runner Instance

One running or configured CLI instance.

```ts
type RunnerInstance = {
  id: string; // codex-1, claude-2
  type: RunnerType;
  displayName: string; // Codex #1
  command: string;
  enabled: boolean;
  processId?: number;
  workspaceMode: "shared" | "worktree";
  worktreePath?: string;
};
```

### Seat

A classroom seat is the visual and state representation of a runner instance.

```ts
type SeatState =
  | "idle"
  | "queued"
  | "reading"
  | "coding"
  | "testing"
  | "reviewing"
  | "checking"
  | "waiting_user"
  | "blocked"
  | "done"
  | "failed"
  | "stopped";

type SeatView = {
  id: string;
  runnerType: RunnerType;
  name: string;
  state: SeatState;
  stateText: string;
  currentTask?: string;
  currentAgent?: RegistryRef;
  currentSkill?: RegistryRef;
  currentAction?: string;
  changedFiles: number;
  runtimeMs: number;
  needsUser: boolean;
};
```

### Assignment

An instruction given to one seat.

```ts
type Assignment = {
  id: string;
  sessionId: string;
  targetSeatId: string;
  sourceSeatIds: string[];
  instruction: string;
  inferredIntent?: "write" | "review" | "check" | "compare" | "test" | "ask";
  agent?: RegistryRef;
  skill?: RegistryRef;
  contextPack: ContextPack;
  status: "queued" | "running" | "done" | "failed" | "stopped";
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
};
```

### Classroom Command

Commands should be UI-independent. TUI keys, slash commands, and future Web buttons all map to these commands.

```ts
type ClassroomCommand =
  | { type: "select_seat"; seatId: string }
  | { type: "dispatch"; targetSeatId: string; instruction: string; sourceSeatIds: string[] }
  | { type: "pause_seat"; seatId: string }
  | { type: "resume_seat"; seatId: string }
  | { type: "stop_seat"; seatId: string }
  | { type: "approve_gate"; gateId: string }
  | { type: "reject_gate"; gateId: string }
  | { type: "run_hook"; hookId: string; seatId?: string }
  | { type: "start_flow"; flowId: string; task: string; roleAssignments: RoleAssignment[] };
```

### Classroom View

The TUI and future frontend should render from this object.

```ts
type ClassroomView = {
  session: {
    id: string;
    title: string;
    projectPath: string;
    branch?: string;
    startedAt: string;
    runtimeMs: number;
  };
  blackboard: BlackboardView;
  seats: SeatView[];
  selectedSeatId?: string;
  desk?: DeskView;
  registryStats: {
    agents: number;
    skills: number;
    hooks: number;
  };
};
```

### Desk View

```ts
type DeskView = {
  seatId: string;
  title: string;
  currentTask?: string;
  currentAction?: string;
  agent?: RegistryRef;
  skill?: RegistryRef;
  hooks: HookRunView[];
  activities: ActivityView[];
  files: FileChangeView[];
  approvals: ApprovalView[];
  artifacts: ArtifactRef[];
};
```

## Registry

The registry merges agents, skills, hooks, and flows from multiple sources.

Sources:

```text
builtin
~/.agentroom
.agentroom
runner configs: codex, claude, gemini
```

Priority:

```text
project > global > runner > builtin
```

### Registry Item

```ts
type RegistryItemStatus =
  | "ready"
  | "imported"
  | "partial"
  | "unsupported"
  | "conflict";

type RegistryItem = {
  id: string;
  kind: "agent" | "skill" | "hook" | "flow";
  title: string;
  source: RegistrySource;
  status: RegistryItemStatus;
  enabled: boolean;
  priority: number;
  raw?: unknown;
  normalized?: NormalizedAgent | NormalizedSkill | NormalizedHook | NormalizedFlow;
  warnings: string[];
};
```

### Agent

```ts
type NormalizedAgent = {
  id: string;
  name: string;
  description: string;
  color: UiColor;
  triggers?: TriggerRule[];
  defaultSkills?: string[];
};
```

### Skill

```ts
type NormalizedSkill = {
  id: string;
  name: string;
  description: string;
  color: UiColor;
  triggers?: TriggerRule[];
  prompt?: string;
  checklist?: string[];
};
```

### Hook

```ts
type NormalizedHook = {
  id: string;
  name: string;
  when:
    | "before_assignment"
    | "after_assignment"
    | "before_handoff"
    | "after_handoff"
    | "before_memory_write";
  type: "shell" | "js" | "python" | "approval";
  command?: string;
  script?: string;
  auto: boolean;
  risk?: "low" | "medium" | "high";
};
```

### Flow

```ts
type NormalizedFlow = {
  id: string;
  name: string;
  description?: string;
  roles: string[];
  steps: FlowStep[];
};

type FlowStep = {
  id: string;
  role: string;
  instructionTemplate: string;
  input?: string | string[];
};

type RoleAssignment = {
  role: string;
  seatId: string;
  skill?: string;
};
```

## Local File Layout

Project-local files:

```text
.agentroom/
  config.yaml
  agents/
  skills/
  hooks/
  flows/
  memory/
    project.md
    decisions.jsonl
  sessions/
    sess_YYYYMMDD_HHMMSS/
      classroom.json
      blackboard.json
      shared-memory.md
      events.jsonl
      seats/
        codex-1/
          state.json
          transcript.log
          summary.md
          patch.diff
          artifacts/
        claude-1/
          state.json
          transcript.log
          review.md
          artifacts/
      evidence/
        files.jsonl
        commands.jsonl
        tests.jsonl
        claims.jsonl
```

Global files:

```text
~/.agentroom/
  config.yaml
  agents/
  skills/
  hooks/
  flows/
  memory/
    user.md
```

## Event Log

Events are stored in `events.jsonl`.

```ts
type AgentRoomEvent =
  | { type: "seat.state_changed"; seatId: string; state: SeatState; ts: string }
  | { type: "activity.appended"; seatId: string; text: string; ts: string }
  | { type: "file.changed"; seatId: string; path: string; changeType: "M" | "A" | "D"; ts: string }
  | { type: "hook.started"; hookId: string; seatId?: string; ts: string }
  | { type: "hook.completed"; hookId: string; ok: boolean; ts: string }
  | { type: "approval.requested"; gateId: string; seatId?: string; reason: string; ts: string }
  | { type: "assignment.started"; assignmentId: string; seatId: string; ts: string }
  | { type: "assignment.completed"; assignmentId: string; seatId: string; ts: string }
  | { type: "assignment.failed"; assignmentId: string; seatId: string; error: string; ts: string };
```

## Context and Memory

### Context Pack

Every assignment receives a generated context pack.

```ts
type ContextPack = {
  userInstruction: string;
  blackboardSummary: string;
  projectMemory?: string;
  userMemory?: string;
  selectedAgent?: RegistryRef;
  selectedSkill?: RegistryRef;
  sourceSeats: SourceSeatContext[];
  artifacts: ArtifactRef[];
  evidence: EvidenceRef[];
};
```

Source seat context includes summary, diff, changed files, artifacts, and evidence from referenced seats.

### Blackboard

```ts
type Blackboard = {
  sessionId: string;
  task?: string;
  facts: Fact[];
  claims: Claim[];
  openQuestions: string[];
  decisions: Decision[];
  artifacts: ArtifactRef[];
};
```

Important claims should include evidence:

```ts
type Claim = {
  id: string;
  text: string;
  fromSeatId: string;
  evidence: EvidenceRef[];
  status: "unverified" | "verified" | "rejected";
};
```

## Hook System

Hook types supported in MVP:

- shell
- js
- python
- approval

JS and Python hooks can return blackboard updates and memory candidates. Shell hooks cannot directly modify memory or blackboard.

### Hook Context

```ts
type HookContext = {
  sessionId: string;
  assignmentId?: string;
  seatId?: string;
  projectRoot: string;
  worktreePath?: string;
  event: string;
  runner?: RunnerInstance;
  agent?: RegistryRef;
  skill?: RegistryRef;
  blackboard: Blackboard;
  artifacts: ArtifactRef[];
  changedFiles: FileChangeView[];
  env: Record<string, string>;
};
```

### Hook Result

```ts
type HookResult = {
  ok: boolean;
  message?: string;
  events?: AgentRoomEvent[];
  artifacts?: ArtifactRef[];
  blackboardUpdates?: BlackboardUpdate[];
  memoryCandidates?: MemoryCandidate[];
  warnings?: string[];
};
```

### Python Hook Protocol

Python hooks receive `HookContext` on stdin and return `HookResult` on stdout as JSON.

### JS Hook Protocol

JS hooks export a default async function:

```js
export default async function hook(ctx) {
  return { ok: true };
}
```

## Runner Adapters

Runner adapters are responsible for:

- probing local installation
- starting assignments
- capturing stdout/stderr
- saving transcripts
- updating seat state
- collecting artifacts after execution

```ts
interface RunnerAdapter {
  type: RunnerType;
  displayName: string;
  probe(): Promise<RunnerProbe>;
  run(assignment: Assignment, ctx: RunnerRunContext): AsyncIterable<AgentRoomEvent>;
  stop(instanceId: string): Promise<void>;
}
```

MVP can treat each runner as a black-box CLI process. Deep structured integrations can come later.

## Workspace Strategy

Assignment workspace mode:

- `ask`, `review`, `check`, `compare`: shared workspace.
- `write`, `test` with file edits: isolated git worktree when another write assignment is active.

Worktree creation and cleanup should be explicit and visible in hooks/events.

## Future Web API Shape

MVP does not need a Web server, but the core should preserve these boundaries:

```text
GET /api/classroom      -> ClassroomView
WS  /api/events         -> AgentRoomEvent stream
POST /api/commands      -> ClassroomCommand
```

