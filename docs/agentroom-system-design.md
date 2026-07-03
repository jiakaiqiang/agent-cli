# AgentRoom 系统设计文档

> 基于 `docs/agentroom-product-spec.md`、`docs/agentroom-architecture.md` 与 `design/agentroom-design-approved.md` 整理。  
> 当前设计范围：V1 = 黑盒无头进程 + 多工具同屏教室 TUI。Registry、hooks、flow、memory、claim verification 推迟到 V1 之后。

## 1. 背景与目标

AgentRoom 是面向 coding agents 的本地 CLI 教室。它不替代 Codex CLI、Claude Code、Gemini CLI，而是在这些本地 coding CLI 之上提供一层编排、可视化与上下文交接能力。

V1 的核心目标：

- 在原生 Windows 环境下驱动 Codex、Claude、Gemini 的无头 CLI 进程，不依赖 tmux、WSL 或 PTY。
- 在一个 Ink TUI 中同屏展示多个 runner 实例，每个实例对应一个教室座位。
- 支持用户用 `@seat` 自然语言派发任务，例如 `@codex#1 修复登录超时 bug`。
- 支持座位之间通过 ContextPack 交接上下文，核心内容为前一座位的 `summary.md` 与 `patch.diff`。
- 将会话状态、事件、座位产物持久化到本地文件系统，使用 JSONL 记录事件流，不引入数据库。
- 提供基础控制能力：启动 assignment、跟踪状态、停止运行中的座位、查看 transcript tail、变更文件与 summary。

V1 非目标：

- 不做 registry 系统，包括 agents、skills、hooks、flows 的加载、合并和自动匹配。
- 不做 hooks 运行时。
- 不做 flow 模式。
- 不做长期 memory 与审批队列。
- 不做 claim verification / 裁判系统。
- 不做 Web UI 或 Web 服务。
- 不接任何 LLM API，只调用用户本机已有 CLI。

## 2. 设计原则

1. 走廊优先：先验证单座位 `派发 -> worktree 执行 -> diff + summary 回收` 的闭环，再扩展到多座位 TUI。
2. Runner 黑盒化：V1 不假设 agent 内部结构化状态，只通过进程退出码、stdout/stderr、文件产物和 git diff 判断结果。
3. 原始指令权威：AgentRoom 可以解析目标座位和来源座位，但不在 V1 推断 agent、skill 或 intent。
4. 上下文隔离：每个座位保留自己的 transcript 和产物，交接时只传递明确的 ContextPack，不混合所有 transcript。
5. 文件即状态：会话状态可从 `.agentroom/sessions/<session>/` 恢复，事件以 append-only JSONL 记录。
6. Windows 原生优先：所有进程、路径、worktree、kill 行为都必须在 Windows 原生环境可用。

## 3. 总体架构

```text
+---------------------------+
|        Ink TUI            |
| App / SeatCard / Desk     |
+-------------+-------------+
              |
              v
+---------------------------+
|    Classroom Controller    |
| command -> state -> event  |
+------+------+-------------+
       |      |       
       |      v
       |  +------------------+
       |  |  Storage Layer   |
       |  | events / seats   |
       |  +------------------+
       |
       v
+---------------------------+
| Assignment Dispatcher      |
| @seat parser / ContextPack |
+-------------+-------------+
              |
              v
+---------------------------+
| Runner Adapter Layer       |
| codex / claude / gemini    |
+-------------+-------------+
              |
              v
+---------------------------+
| Local CLI Processes        |
| child_process / execa      |
+---------------------------+
```

### 3.1 顶层模块

```text
src/
  probe.ts
  corridor.ts
  dispatch-parser.ts
  contextpack.ts
  storage.ts
  types.ts
  adapters/
    runner.ts
    codex.ts
    claude.ts
    gemini.ts
  tui/
    App.tsx
    BlackboardHeader.tsx
    SeatCard.tsx
    DeskPanel.tsx
```

模块职责：

- `probe.ts`：探测三家 CLI 的安装、无头模式命令、退出码和输出格式。
- `corridor.ts`：执行单座位走廊闭环，负责 worktree、runner 执行、产物回收。
- `dispatch-parser.ts`：解析 `@seat` 目标与来源引用。
- `contextpack.ts`：从来源座位产物组装 ContextPack。
- `storage.ts`：负责 `.agentroom/sessions/` 下的事件与座位文件读写。
- `adapters/*`：封装不同 runner 的命令模板、探测和进程运行。
- `tui/*`：Ink UI 渲染教室头、座位卡片、选中座位详情。

## 4. 核心领域模型

### 4.1 Runner

Runner 是可被 AgentRoom 驱动的本地 coding CLI 类型。

```ts
type RunnerType = "codex" | "claude" | "gemini";

type RunnerInstance = {
  id: string;
  type: RunnerType;
  displayName: string;
  command: string;
  enabled: boolean;
  processId?: number;
  workspaceMode: "shared" | "worktree";
  worktreePath?: string;
};
```

### 4.2 Seat

Seat 是 runner 实例在教室中的可视化状态。

```ts
type SeatState = "idle" | "queued" | "running" | "done" | "failed" | "stopped";

type SeatView = {
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
```

V1 只保留 6 态。`reading`、`coding`、`testing`、`reviewing`、`waiting_user`、`blocked` 等细粒度状态需要深度集成，推迟到 V1 之后。

### 4.3 Assignment

Assignment 是派发给某个座位的任务。

```ts
type Assignment = {
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
```

V1 保留原文指令，不做 agent/skill 自动推断。`sourceSeatIds` 来自指令中的其他 `@seat` 引用，用于组装交接上下文。

### 4.4 ContextPack

ContextPack 是座位之间的交接包。

```ts
type ContextPack = {
  userInstruction: string;
  sourceSeats: SourceSeatContext[];
  artifacts: ArtifactRef[];
};

type SourceSeatContext = {
  seatId: string;
  summary?: string;
  patch?: string;
  changedFiles: string[];
  artifacts: ArtifactRef[];
};
```

V1 的核心要求是：第二个座位能看到被引用座位的 summary、diff 和变更文件清单，并在输出中实际引用这些内容。

### 4.5 ClassroomView

TUI 和未来 Web UI 都应基于同一类 view model 渲染。

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
  blackboard: {
    title: string;
  };
  seats: SeatView[];
  selectedSeatId?: string;
  desk?: DeskView;
};
```

V1 的 blackboard 只显示会话标题和运行时间，不维护 facts、claims、decisions。

## 5. 关键流程设计

### 5.1 启动与探测流程

1. 用户启动 AgentRoom TUI。
2. 系统执行本地 CLI 探测：
   - `codex --version`
   - `claude --version`
   - `gemini --version`
3. 根据探测结果创建可用 RunnerInstance。
4. 默认复用上次会话启用的 runner 选择；用户可重新选择。
5. 初始化 session 目录与 `events.jsonl`。
6. TUI 渲染 blackboard header、seat cards 与默认 desk。

异常处理：

- CLI 不存在：该 runner 标记为 unavailable，不创建座位或显示不可用提示。
- 版本命令超时：记录 probe failure，不阻塞其他 runner。
- 上次会话选择不可用：回退到当前可探测 runner。

### 5.2 派发流程

输入示例：

```text
@claude#1 审查 @codex#1 的结果，重点看回归风险
```

处理步骤：

1. `dispatch-parser.ts` 解析目标座位：`claude-1`。
2. 解析来源座位：`codex-1`。
3. 保留原文指令作为 `Assignment.instruction`。
4. `contextpack.ts` 读取 `codex-1` 的 `summary.md`、`patch.diff` 与变更文件。
5. 创建 Assignment，写入 queued 状态事件。
6. Controller 调用对应 RunnerAdapter 执行。
7. TUI 从事件流更新座位状态和 desk 内容。

V1 不做：

- 不判断这是 review/check/test。
- 不自动选择 agent 或 skill。
- 不解析 flow。

### 5.3 Runner 执行流程

1. 根据 assignment 类型与当前活跃写入任务决定工作区模式。
2. 写入任务默认使用 git worktree 隔离。
3. RunnerAdapter 拼接该 runner 的无头命令和 prompt。
4. 使用 `child_process` 或 `execa` 启动子进程。
5. 实时读取 stdout/stderr，追加到 seat transcript，并写入 `activity.appended` 事件。
6. 进程结束后记录 exit code。
7. 回收产物：
   - `git diff` -> `patch.diff`
   - `git diff --stat` -> diffstat
   - worktree 根目录 `AGENTROOM_SUMMARY.md` -> `summary.md`
   - 若 summary 缺失，使用确定性兜底摘要器生成 summary。
8. 根据退出码和产物回收结果设置座位状态为 `done` 或 `failed`。

### 5.4 摘要契约

Runner 完成任务时应在 worktree 根目录写入 `AGENTROOM_SUMMARY.md`：

```yaml
summary: 一句话说明改了什么
changed_files:
  - src/auth/session.ts
tests:
  - command: npm test
    exit_code: 0
claims:
  - text: 修复了会话超时未清理的问题
    command: npm test -- session.test.ts
    expected_signal: exit 0
```

V1 只依赖 `summary`、`changed_files` 和 `tests`。`claims` 字段为 V1 之后的裁判系统预留。

兜底摘要器数据源：

- `git diff --stat`
- 变更文件清单
- runner 退出码
- 可用时从结构化 stdout 中提取测试命令和退出码

兜底摘要器不生成 claims。

### 5.5 Stop Seat 流程

1. 用户在 TUI 中选择正在运行的座位并执行 stop。
2. Controller 发送 `stop_seat` 命令。
3. RunnerAdapter kill 对应进程树。
4. 写入 `seat.state_changed`，状态变为 `stopped`。
5. 保留 transcript、worktree、已有 diff 与错误信息。
6. Desk 面板显示停止原因与最后活动。

### 5.6 会话恢复流程

1. 启动时扫描 `.agentroom/sessions/`。
2. 读取最近 session 的 `events.jsonl` 与 seat `state.json`。
3. 重建 ClassroomView。
4. 对未完成状态做保守恢复：
   - `running` 且无存活进程：标记为 `failed` 或 `stopped`，记录恢复事件。
   - `queued`：保留为 queued 或让用户重新派发。

## 6. 本地存储设计

V1 使用项目本地 `.agentroom/` 目录：

```text
.agentroom/
  sessions/
    sess_YYYYMMDD_HHMMSS/
      events.jsonl
      classroom.json
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
          summary.md
          patch.diff
          artifacts/
```

V1 可不创建：

- `blackboard.json`
- `shared-memory.md`
- `evidence/`
- `agents/`
- `skills/`
- `hooks/`
- `flows/`

### 6.1 事件日志

`events.jsonl` 是 append-only 事件流：

```ts
type AgentRoomEvent =
  | { type: "seat.state_changed"; seatId: string; state: SeatState; ts: string }
  | { type: "activity.appended"; seatId: string; text: string; ts: string }
  | { type: "file.changed"; seatId: string; path: string; changeType: "M" | "A" | "D"; ts: string }
  | { type: "assignment.started"; assignmentId: string; seatId: string; ts: string }
  | { type: "assignment.completed"; assignmentId: string; seatId: string; ts: string }
  | { type: "assignment.failed"; assignmentId: string; seatId: string; error: string; ts: string };
```

V1 不写 `hook.*`、`approval.*` 事件。

## 7. 工作区策略

V1 采用保守工作区策略：

- 单个写入 assignment 可在隔离 worktree 中运行。
- 多个写入 assignment 同时运行时必须使用不同 git worktree。
- review/check/compare 类任务可以共享当前工作区，但 V1 不做 intent 推断，因此默认通过显式命令或保守策略处理。
- worktree 创建前必须检查主工作区脏状态。
- 成功后不自动删除 worktree，避免误删现场；清理命令推迟或手动触发。

建议 worktree 路径：

```text
.agentroom/worktrees/<session-id>/<seat-id>/
```

## 8. Runner Adapter 设计

统一接口：

```ts
interface RunnerAdapter {
  type: RunnerType;
  displayName: string;
  probe(): Promise<RunnerProbe>;
  run(assignment: Assignment, ctx: RunnerRunContext): AsyncIterable<AgentRoomEvent>;
  stop(instanceId: string): Promise<void>;
}
```

Adapter 需要处理：

- runner 是否安装。
- 无头模式命令模板。
- prompt 注入方式。
- stdout/stderr 流式捕获。
- 超时 kill。
- exit code 映射。
- transcript 写入。

V1 以 probe 实测结果确定具体命令模板，设计上不硬编码不可验证的旗标。

## 9. TUI 设计

TUI 使用 Ink + React，包含三个核心区域：

1. BlackboardHeader：显示 AgentRoom、session id、运行时间、会话标题。
2. SeatCard 列表：显示每个座位的 runner 类型、状态、当前任务。
3. DeskPanel：显示选中座位的当前任务、活动 tail、变更文件、summary 和错误信息。

交互：

- 左右方向键切换座位。
- 输入 `@seat instruction` 派发任务。
- stop 快捷键停止当前座位。
- 事件流 tail 实时刷新 UI。

V1 颜色只按 runner 类型区分：

- Codex：青色或蓝色系。
- Claude：橙色或洋红色系。
- Gemini：紫色或蓝色系。

## 10. 错误处理与失败路径

| 场景 | 处理 |
|---|---|
| runner 未安装 | probe 失败，座位不可用，不影响其他 runner |
| 无头命令退出非 0 | assignment 标记 failed，保留 transcript 和 stderr |
| 进程超时 | kill 进程树，状态 failed，记录 timeout |
| 用户 stop | kill 进程树，状态 stopped，保留现场 |
| summary 缺失 | 使用兜底摘要器生成 summary |
| patch 为空 | 允许 done，但 summary 需说明无文件变更 |
| worktree 创建失败 | assignment failed，提示脏状态或 git 错误 |
| events.jsonl 写入失败 | 当前任务 failed，TUI 显示存储错误 |
| 会话恢复遇到 running 但进程不存在 | 标记 failed/stopped 并写恢复事件 |

## 11. 安全边界

V1 的安全边界主要来自本地进程控制与 worktree 隔离：

- AgentRoom 不接远程 LLM API，不管理第三方 API key。
- runner 子进程只在指定 cwd/worktree 中运行。
- 写入任务使用隔离 git worktree，避免多个 agent 覆盖同一工作区。
- 不自动执行 runner 产出的任意命令。
- 裁判系统和命令白名单推迟到 V1 之后。
- 成功后不自动删除 worktree，降低误删风险。

需要在 probe 阶段确认：

- 各 CLI 无头模式权限旗标。
- 是否可限制写入范围。
- Windows 下 kill 进程树是否可靠。
- stdout/stderr 编码与流式输出行为。

## 12. 可观测性

V1 的可观测性来自三类文件：

- `events.jsonl`：状态变化、活动、assignment 开始/结束。
- `transcript.log`：每个座位的原始 stdout/stderr。
- `summary.md` / `patch.diff`：交付产物。

TUI 只显示 transcript 最近 N 行，完整日志保存在座位目录中。

## 13. 扩展设计

V1 后可以在不重写核心编排逻辑的前提下增加：

- Registry：加载 agents、skills、hooks、flows，支持 project > global > runner > builtin 优先级。
- Hook 系统：支持 shell、JS、Python、approval hooks。
- Blackboard：从标题扩展为 facts、claims、decisions、openQuestions。
- Claim verification：对可重放 claims 执行测试/构建/lint 白名单命令并打 `verified/rejected`。
- Flow 模式：将常用多座位流程封装为宏。
- Web UI：复用 `ClassroomView`、`ClassroomCommand`、`AgentRoomEvent`。
- Replay：基于 events + evidence 回放一次教室会话。

## 14. 实施顺序

1. 最小脚手架：`package.json`、`tsconfig.json`、核心类型。
2. `probe.ts`：实测 Codex、Claude、Gemini 的无头命令、输出、退出码和权限旗标。
3. `runner.ts` 与各 runner adapter：通用进程管理、超时、kill、stdout/stderr 捕获。
4. `storage.ts`：session 目录、events.jsonl、seat state、transcript、summary、patch。
5. `corridor.ts`：单座位走廊闭环。
6. `contextpack.ts`：从来源座位组装 diff + summary 交接包。
7. `dispatch-parser.ts`：解析 `@target` 与来源 `@seat` 引用。
8. TUI：seat cards、desk panel、事件 tail。
9. Stop seat 与失败恢复。
10. 双座位交接 demo 与 V1 验收。

## 15. 验收标准

V1 完成需满足：

- `tsx src/probe.ts` 能在 Windows 原生环境探测三家 CLI。
- `tsx src/corridor.ts "task"` 能完成单座位派发，生成 `events.jsonl`、`patch.diff`、`summary.md`。
- 超时和 runner 非 0 退出能进入 failed 状态并保留 transcript。
- 第二座位派发时 ContextPack 包含第一座位的 diff 和 summary。
- 第二座位输出能实际引用第一座位 diff 的具体内容。
- Ink TUI 同屏展示至少两个座位，且至少来自两家不同 runner。
- TUI 支持 `@seat` 派发、座位切换、状态实时更新与 stop。
- 会话状态保存在 `.agentroom/sessions/`，重启后可恢复最近会话视图。

## 16. 风险与开放问题

| 风险 / 问题 | 缓解方式 |
|---|---|
| 三家 CLI 的无头模式行为不一致 | probe 阶段先实测，再固化 adapter |
| runner 不生成 `AGENTROOM_SUMMARY.md` | 使用确定性兜底摘要器 |
| stdout/stderr 输出无法可靠推断状态 | V1 只显示 coarse state + transcript tail |
| 多 agent 同时写入产生冲突 | 写入任务使用 git worktree 隔离 |
| Windows 进程树 kill 不完整 | adapter 层专门封装并测试 |
| 权限旗标不能限制写入范围 | 以 worktree 隔离为主边界，probe 后记录限制 |
| 用户误以为 V1 已有裁判能力 | 文档和 UI 明确 claim verification 是 V1 后功能 |
| AgentRoom 名称可能与同品类冲突 | 开源/npm 发布前再做命名决策 |
