# AgentRoom 架构

> **2026-07-03 更新**：本文档已按批准设计（design/agentroom-design-approved.md）调整。V1 = 黑盒无头进程 + 多工具同屏教室 TUI。Registry/hooks/flow/memory 推迟到 V1 之后。

## 技术栈

V1 技术栈：

- 语言：TypeScript
- 运行时：Node.js
- TUI：Ink + React
- 进程执行：Node `child_process` 或 `execa`（黑盒无头进程，管道读输出）
- 配置：最小化（V1 只需三家 CLI 路径探测）
- 存储：filesystem + JSONL
- 数据库：无

**推迟到 V1 之后**：
- CLI 解析器（commander/clipanion）—— V1 可直接 `tsx src/...`
- YAML 配置 —— V1 配置最小化
- Registry 系统 —— agents/skills/hooks/flows 全部推迟

## 顶层模块（V1 精简）

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

## 核心概念

### Runner 类型

支持的工具类型：

```ts
type RunnerType = "codex" | "claude" | "gemini";
```

### Runner 实例

一个正在运行或已配置的 CLI 实例。

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

### 座位

教室座位是 runner 实例的可视化与状态表示。

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

分配给某个座位的指令。

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

### 教室命令

命令应与 UI 无关。TUI 按键、slash commands 和未来的 Web 按钮都映射到这些命令。

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

### 教室视图

TUI 和未来前端都应基于这个对象渲染。

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

### Desk 视图

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

Registry 会合并来自多个来源的 agents、skills、hooks 和 flows。

来源：

```text
builtin
~/.agentroom
.agentroom
runner configs: codex, claude, gemini
```

优先级：

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

## 本地文件布局

项目本地文件：

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

全局文件：

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

## 事件日志

事件存储在 `events.jsonl` 中。

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

## 上下文与记忆

### Context Pack

每个 assignment 都会收到一个生成的 context pack。

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

来源座位上下文包含被引用座位的 summary、diff、变更文件和 artifacts。

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

重要 claims 应包含 evidence：

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

## Hook 系统（V1 推迟）

> **2026-07-03 更新**：整个 Hook 系统（shell/JS/Python/approval 四运行时）推迟到 V1 之后。

MVP 支持的 Hook 类型：

- shell
- js
- python
- approval

JS 和 Python hooks 可以返回 blackboard updates 和 memory candidates。Shell hooks 不能直接修改 memory 或 blackboard。

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

### Python Hook 协议

Python hooks 从 stdin 接收 `HookContext`，并通过 stdout 返回 JSON 格式的 `HookResult`。

### JS Hook 协议

JS hooks 导出一个默认 async 函数：

```js
export default async function hook(ctx) {
  return { ok: true };
}
```

## Runner 适配器

Runner 适配器负责：

- 探测本地安装。
- 启动 assignments。
- 捕获 stdout/stderr。
- 保存 transcripts。
- 更新座位状态。
- 执行结束后收集 artifacts。

```ts
interface RunnerAdapter {
  type: RunnerType;
  displayName: string;
  probe(): Promise<RunnerProbe>;
  run(assignment: Assignment, ctx: RunnerRunContext): AsyncIterable<AgentRoomEvent>;
  stop(instanceId: string): Promise<void>;
}
```

MVP 可以把每个 runner 当作黑盒 CLI 进程处理。更深的结构化集成可以稍后再做。

## 工作区策略

Assignment 工作区模式：

- `ask`、`review`、`check`、`compare`：共享工作区。
- 带文件编辑的 `write`、`test`：当另一个写入 assignment 活跃时使用隔离 git worktree。

Worktree 创建与清理应是显式的，并在 hooks/events 中可见。

## 未来 Web API 形态

MVP 不需要 Web 服务器，但核心应保留这些边界：

```text
GET /api/classroom      -> ClassroomView
WS  /api/events         -> AgentRoomEvent stream
POST /api/commands      -> ClassroomCommand
```

