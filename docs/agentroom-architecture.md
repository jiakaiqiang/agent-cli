# AgentRoom Architecture

> **2026-07-03 更新**：本文档已按批准设计（design/agentroom-design-approved.md）调整。V1 = 黑盒无头进程 + 多工具同屏教室 TUI。Registry/hooks/flow/memory 推迟到 V1 之后。

## Technical Stack

V1 stack:

- Language: TypeScript
- Runtime: Node.js
- TUI: Ink + React
- Process execution: Node `child_process` or `execa`（黑盒无头进程，管道读输出）
- Config: 最小化（V1 只需三家 CLI 路径探测）
- Storage: filesystem + JSONL
- Database: none

**推迟到 V1 之后**：
- CLI parser (commander/clipanion) —— V1 可直接 `tsx src/...`
- YAML config —— V1 配置最小化
- Registry system —— agents/skills/hooks/flows 全部推迟

## Top-Level Modules（V1 精简）

```text
src/
  probe.ts          # 三家 CLI 无头模式探测实验
  corridor.ts       # 单座位派发 → worktree 执行 → 回收
  contextpack.ts    # 双座位交接 ContextPack 组装
  tui/
    App.tsx         # Ink TUI 主界面
    SeatCard.tsx    # 座位卡片组件
    DeskPanel.tsx   # 座位详情面板
  adapters/
    runner.ts       # 通用黑盒子进程管理
    codex.ts        # Codex 启动命令模板（probe 后确认）
    claude.ts       # Claude 启动命令模板
    gemini.ts       # Gemini 启动命令模板
  types.ts          # Assignment / ContextPack / AgentRoomEvent 子集
  storage.ts        # events.jsonl / 座位文件读写
```

**不在 V1 范围**：
- `registry/` —— 推迟
- `memory/` —— 推迟
- `hooks/` —— 推迟
- `builtin/` —— 推迟
- `cli/` 完整 CLI 框架 —— V1 可直接运行 tsx

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
  | "running"    // V1 粗粒度状态（黑盒进程运行中）
  | "done"
  | "failed"
  | "stopped";

// V1 之后深度集成时可能恢复的细粒度状态（当前推迟）：
// | "reading" | "coding" | "testing" | "reviewing" | "checking" | "waiting_user" | "blocked"

type SeatView = {
  id: string;
  runnerType: RunnerType;
  name: string;
  state: SeatState;
  stateText: string;             // 当前活动描述（从 transcript tail 提取）
  currentTask?: string;          // 当前 assignment 指令
  currentAgent?: RegistryRef;    // V1 推迟（无 registry）
  currentSkill?: RegistryRef;    // V1 推迟（无 registry）
  currentAction?: string;
  changedFiles: number;
  runtimeMs: number;
  needsUser: boolean;            // V1 为 false（无交互审批）
};
```

**V1 简化说明**：
- `SeatState` 收敛为 6 态（idle/queued/running/done/failed/stopped），细粒度状态推迟
- `currentAgent`/`currentSkill` 为空（registry 推迟）
- `needsUser` 恒为 false（交互审批属于深度集成，V1 不做）

### Assignment

An instruction given to one seat.

```ts
type Assignment = {
  id: string;
  sessionId: string;
  targetSeatId: string;
  sourceSeatIds: string[];       // 用于 ContextPack 组装
  instruction: string;            // 原文指令
  inferredIntent?: "write" | "review" | "check" | "compare" | "test" | "ask"; // 保留但 V1 不实现推断
  agent?: RegistryRef;            // V1 推迟（无 registry）
  skill?: RegistryRef;            // V1 推迟（无 registry）
  contextPack: ContextPack;
  status: "queued" | "running" | "done" | "failed" | "stopped";
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
};
```

**V1 简化说明**：
- `agent`/`skill` 为空（registry 推迟）
- `inferredIntent` 字段保留但 V1 不填（推断逻辑推迟）

### Classroom Command

Commands should be UI-independent. TUI keys, slash commands, and future Web buttons all map to these commands.

```ts
type ClassroomCommand =
  | { type: "select_seat"; seatId: string }
  | { type: "dispatch"; targetSeatId: string; instruction: string; sourceSeatIds: string[] }
  | { type: "stop_seat"; seatId: string }
  | { type: "approve_gate"; gateId: string }  // V1 推迟（无交互审批）
  | { type: "reject_gate"; gateId: string }   // V1 推迟（无交互审批）
  // V1 推迟：
  // | { type: "pause_seat"; seatId: string }
  // | { type: "resume_seat"; seatId: string }
  // | { type: "run_hook"; hookId: string; seatId?: string }
  // | { type: "start_flow"; flowId: string; task: string; roleAssignments: RoleAssignment[] }
```

**V1 简化说明**：
- 保留 `select_seat` / `dispatch` / `stop_seat` / `approve_gate` / `reject_gate`（后两者接口保留但 V1 不实现）
- `pause`/`resume`/`run_hook`/`start_flow` 推迟

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
  blackboard: BlackboardView;        // V1 最小版（只有会话标题）
  seats: SeatView[];
  selectedSeatId?: string;
  desk?: DeskView;
  registryStats: {                   // V1 推迟（无 registry）
    agents: number;
    skills: number;
    hooks: number;
  };
};
```

**V1 简化说明**：
- `blackboard` 只显示会话标题和运行时间（阶段 3a 补完整版）
- `registryStats` 全为 0（registry 推迟）

### Desk View

```ts
type DeskView = {
  seatId: string;
  title: string;
  currentTask?: string;
  currentAction?: string;
  agent?: RegistryRef;               // V1 推迟（无 registry）
  skill?: RegistryRef;               // V1 推迟（无 registry）
  hooks: HookRunView[];              // V1 推迟（无 hooks）
  activities: ActivityView[];        // V1 简化为 transcript tail
  files: FileChangeView[];
  approvals: ApprovalView[];         // V1 推迟（无交互审批）
  artifacts: ArtifactRef[];
};
```

**V1 简化说明**：
- `agent`/`skill` 为空
- `hooks` 为空数组
- `activities` 简化为 transcript 最近 N 行
- `approvals` 为空数组

## Registry（V1 推迟）

> **2026-07-03 更新**：整个 Registry 系统（agents/skills/hooks/flows 的加载、合并、推断）推迟到 V1 之后。以下内容仅作架构参考。

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
  blackboardSummary: string;         // V1 推迟（无 blackboard）
  projectMemory?: string;            // V1 推迟（无 memory）
  userMemory?: string;               // V1 推迟（无 memory）
  selectedAgent?: RegistryRef;       // V1 推迟（无 registry）
  selectedSkill?: RegistryRef;       // V1 推迟（无 registry）
  sourceSeats: SourceSeatContext[];  // V1 核心：diff + summary
  artifacts: ArtifactRef[];
  evidence: EvidenceRef[];           // V1 推迟（无 evidence 系统）
};
```

**V1 简化说明**：
- 核心字段 `userInstruction` + `sourceSeats`（包含 diff + summary）
- `blackboardSummary`/`projectMemory`/`userMemory`/`selectedAgent`/`selectedSkill`/`evidence` 推迟

Source seat context includes summary, diff, changed files, artifacts from referenced seats.

### Blackboard（V1 推迟）

> **2026-07-03 更新**：完整 Blackboard（facts/claims/openQuestions/decisions）推迟到阶段 3a。V1 只有会话标题显示。

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

**Claim verification（阶段 3a 功能）** 是 AgentRoom 的护城河特性，V1 不实现。

## Hook System（V1 推迟）

> **2026-07-03 更新**：整个 Hook 系统（shell/JS/Python/approval 四运行时）推迟到 V1 之后。

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

