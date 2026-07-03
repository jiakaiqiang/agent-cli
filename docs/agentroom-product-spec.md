# AgentRoom 产品规格

> **2026-07-03 更新**：按批准设计（design/agentroom-design-approved.md）更新。V1 = 走廊（黑盒无头进程）+ 多工具同屏教室 TUI。本文档描述的完整愿景中，部分功能（细粒度状态、agent/skill 显示、hooks）推迟到 V1 之后。

## 定位

AgentRoom 是面向 coding agents 的本地 CLI 教室。

用户像老师一样拥有完整教室视图。每个本地 coding CLI 实例都是教室里的一个座位，例如 `Codex #1`、`Claude #1` 或 `Gemini #1`。用户可以看到谁在工作、谁空闲、~~谁被阻塞~~、~~谁在等待审批~~，以及每个 agent 当前在做什么。

AgentRoom 不打算替代 Codex、Claude Code、Gemini 或其他 coding 工具。它是在这些工具之上的本地编排与可视化层。

## 初始受众

- 主要：项目所有者个人使用。
- 后续可能：面向已经使用多个 coding agents 的开发者开源。

## 首批支持的 Runner

- Codex CLI
- Claude Code (claude -p 无头模式)
- Gemini CLI

后续应可通过 adapter 模块支持更多 runner。

## 核心痛点

多个 coding agents 单独使用很有价值，但放在一起很难协调。

用户想要：

- 启动多个本地 CLI 实例。
- 给每个实例分配工作。
- 让 agents 互相审查或接续彼此的工作。
- 共享有用上下文，但不把所有 transcript 混在一起。
- ~~复用本地/全局/项目/工具配置中的 agents、skills 和 hooks。~~ （V1 推迟）
- 在终端里直观看到状态。

## 教室隐喻

AgentRoom 使用教室概念：

- Blackboard：~~共享任务、摘要、事实、claims、决策、开放问题。~~ （V1 只显示会话标题）
- Seat：一个正在运行的 CLI 实例，例如 `Codex #1`。
- Desk：选中座位的详情。
- Assignment：分配给一个座位的任务。
- Homework：diff、patch、~~报告~~、~~测试输出~~、summary。
- Hand-off：把一个座位的输出交给另一个座位。
- ~~Memory：已批准的长期项目/用户知识。~~ （V1 推迟）

## 主界面（V1 版本）

TUI 应展示清晰的教室状态视图：

```text
┌─ AgentRoom ─ Session sess_20260702_001 ─ 00:15:32 ───────────────┐
│ 黑板: 修复登录超时 bug 并添加回归测试                                │
└────────────────────────────────────────────────────────────────────┘

┌─ Codex #1 ────────┐  ┌─ Claude #1 ───────┐
│ 状态: running       │  │ 状态: idle          │
│ 任务: 修复 bug       │  │ 任务: —             │
└────────────────────┘  └────────────────────┘

┌─ Desk: Codex #1 ───────────────────────────────────────────────────┐
│ 当前: 正在编辑 src/auth/session.ts                                     │
│ 任务: 最小改动修复登录超时 bug                                          │
│ 文件: M src/auth/session.ts, M src/auth/session.test.ts               │
│ 活动:                                                                 │
│   [12:30:16] Runner 已启动 (codex exec)                              │
│   [12:30:45] 正在写入 src/auth/session.ts...                           │
│   [12:31:02] 正在运行测试...                                           │
└──────────────────────────────────────────────────────────────────────┘
```

**V1 简化说明**：
- 去掉 `A: agent` / `S: skill` 标签（registry 推迟）
- 去掉 `Hooks:` 行（hooks 推迟）
- Seat 状态只显示 6 态（idle/queued/running/done/failed/stopped），不显示细粒度状态
- Activity 简化为 transcript tail（最近 N 行）

完整版（包含 agent/skill/hooks）是原主界面，推迟到 V1 之后。

## 座位状态（V1 版本）

V1 座位状态：

- `idle`：空闲 / 就绪。
- `queued`：等待 assignment。
- `running`：正在执行（黑盒进程运行中，不细分 reading/coding/testing）。
- `done`：已完成。
- `failed`：已失败。
- `stopped`：已被用户停止。

**推迟到 V1 之后的细粒度状态**（需要深度集成）：
- ~~`reading`~~：读取文件或上下文。
- ~~`coding`~~：编辑代码。
- ~~`testing`~~：运行或编写测试。
- ~~`reviewing`~~：审查另一个 agent 的输出。
- ~~`checking`~~：检查风险、安全性和边界情况。
- ~~`waiting_user`~~：举手，需要用户操作。
- ~~`blocked`~~：卡住。

## 颜色规则（V1 版本）

~~颜色是产品体验的一部分。~~ （完整配色体系推迟到 V1 之后）

V1 颜色规则：

- **Runner 颜色** 标识工具类型：
  - Codex: 蓝色系
  - Claude: 橙色系
  - Gemini: 紫色系

**推迟到 V1 之后**：
- ~~Agent 颜色标识角色。~~
- ~~Skill 颜色标识技能类型。~~
- ~~Hook 颜色标识 hook 类型。~~
- ~~四色分类法（runner/agent/skill/hook）~~
- Skill 颜色标识能力。
- Hook 颜色标识状态/风险。

建议 runner 颜色：

- Codex：青色
- Claude Code：洋红色
- Gemini：蓝色

建议 hook 状态颜色：

- pending：灰色
- running：青色
- success：绿色
- failed：红色
- skipped：黄色
- waiting：洋红色

Agent 和 skill 颜色来自 registry 元数据。若缺失，AgentRoom 会分配稳定颜色。

## 启动体验

启动时，AgentRoom 扫描本地工具：

- `codex --version`
- `claude --version`
- `gemini --version`

启动行为：

- 默认：使用上一次会话启用的 runner 选择。
- 按 `s`：重新选择要启动的 runner 实例。

用户可以启动同一 runner 的多个实例：

```text
添加 Claude Code #1？
再添加一个 Claude Code 实例？
添加 Codex #1？
再添加一个 Codex 实例？
```

每个实例都会成为独立的教室座位：

```text
Codex #1
Codex #2
Claude #1
Gemini #1
```

## 模式

### 1. 教室模式

这是主模式。

用户用自然语言给指定座位分配任务：

```text
@codex#1 修复登录超时 bug，尽量最小改动并补测试
@claude#1 帮我审查 @codex#1 的结果，重点看有没有回归风险
@gemini#1 看一下 @codex#1 和 @claude#1 的结果，有没有安全和边界问题
@codex#2 基于 @claude#1 的意见继续修改
```

不要求使用 `implement` 或 `review` 这样的固定动词。AgentRoom 只需解析：

- 目标座位：`@codex#1`
- 引用的来源座位：`@claude#1`、`@codex#1`
- 用户指令文本

AgentRoom 可以推断 intent 和 skill，但原始指令仍然是权威来源。

### 2. Flow 模式

Flow 模式是教室模式之上的便捷宏。

用户选择一个 flow，然后把角色分配给座位：

```text
/flow bugfix "修复登录超时 bug"

implementer  -> Codex #1
reviewer     -> Claude #1
risk-checker -> Gemini #1
tester       -> Codex #2
```

系统会记住每个 flow 上一次的角色分配。首次运行使用推荐配置；后续运行复用用户上次选择，但仍允许编辑。

Flow 不是产品中心，而是可重复的派发快捷方式。

## Agents、Skills 与 Hooks

AgentRoom 有一个统一 registry，用于：

- Agents：角色，例如 `implementer`、`reviewer`、`checker`。
- Skills：可复用能力包，例如 `bugfix`、`code-review`、`risk-check`。
- Hooks：生命周期动作。

Registry 来源：

1. 内置公共默认值。
2. 用户全局配置：`~/.agentroom`。
3. 项目配置：`.agentroom`。
4. Codex、Claude Code、Gemini 的本地工具配置。

合并优先级：

```text
project > global > local tool config > builtin
```

发生冲突时，项目级条目优先。UI 应显示冲突来源。

## Agent 与 Skill 匹配

Agents 和 skills 可根据用户描述自动选择，也可以显式指定。

示例：

```text
@codex#1 修复登录超时 bug
```

可能自动匹配：

- Agent：`implementer`
- Skill：`bugfix`

```text
@claude#1 作为 architect 使用 strict-review 审查 @codex#1
```

应显式使用：

- Agent：`architect`
- Skill：`strict-review`

优先级：

```text
用户显式选择 > 项目规则 > agent 默认值 > 自动匹配 > 无
```

## 上下文与记忆

AgentRoom 使用混合记忆模型：

- 用于 hand-off 的快速摘要。
- 用于重要 claims、风险和决策的证据。
- 只有用户确认后才写入长期记忆。

记忆层：

- Runner transcript：每个座位的私有原始日志。
- Blackboard：共享会话上下文。
- Evidence：文件、diffs、命令、测试输出、claims。
- Shared memory：用于 hand-offs 的摘要上下文。
- Project memory：已批准的项目知识。
- User memory：已批准的个人偏好。

重要原则：

```text
Agent 文本不是事实。重要事实应该有证据支撑。
```

## 工作区策略

工作区模式按 assignment 类型选择：

- 只读/review/check assignments 可以共享当前工作区。
- 当多个写入实例可能同时运行时，写入 assignments 应使用隔离 git worktrees。

这样可以避免多个 CLI 实例互相覆盖改动。

## 前端扩展

TUI 是第一个客户端，不是核心本身。

核心必须通过前端友好的对象暴露状态：

- `ClassroomView`
- `AgentRoomEvent`
- `ClassroomCommand`

未来 Web UI 应复用同一套 view/event/command 模型，而不是重新实现编排逻辑。

