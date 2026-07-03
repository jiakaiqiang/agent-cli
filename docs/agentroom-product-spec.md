# AgentRoom Product Spec

> **2026-07-03 更新**：按批准设计（design/agentroom-design-approved.md）更新。V1 = 走廊（黑盒无头进程）+ 多工具同屏教室 TUI。本文档描述的完整愿景中，部分功能（细粒度状态、agent/skill 显示、hooks）推迟到 V1 之后。

## Positioning

AgentRoom is a local CLI classroom for coding agents.

The user acts like a teacher with a full classroom view. Each local coding CLI instance is a seat in the classroom, such as `Codex #1`, `Claude #1`, or `Gemini #1`. The user can see who is working, who is idle, ~~who is blocked~~, ~~who is waiting for approval~~, and what each agent is currently doing.

AgentRoom is not intended to replace Codex, Claude Code, Gemini, or other coding tools. It is a local orchestration and visibility layer above them.

## Initial Audience

- Primary: personal use by the project owner.
- Later possibility: open source for developers who already use multiple coding agents.

## First Supported Runners

- Codex CLI
- Claude Code (claude -p 无头模式)
- Gemini CLI

More runners should be possible later through adapter modules.

## Core Pain

Multiple coding agents are useful individually, but hard to coordinate together.

The user wants to:

- Start multiple local CLI instances.
- Assign work to each instance.
- Let agents review or continue each other's work.
- Share useful context without mixing every transcript together.
- ~~Reuse agents, skills, and hooks from local/global/project/tool configurations.~~ （V1 推迟）
- See status visually inside the terminal.

## Classroom Metaphor

AgentRoom uses classroom concepts:

- Blackboard: ~~shared task, summaries, facts, claims, decisions, open questions.~~ （V1 只显示会话标题）
- Seat: one running CLI instance, for example `Codex #1`.
- Desk: details for the selected seat.
- Assignment: a task given to one seat.
- Homework: diff, patch, ~~report~~, ~~test output~~, summary.
- Hand-off: passing one seat's output to another seat.
- ~~Memory: approved long-term project/user knowledge.~~ （V1 推迟）

## Main Screen（V1 版本）

The TUI should show a clear classroom status view:

```text
┌─ AgentRoom ─ Session sess_20260702_001 ─ 00:15:32 ───────────────┐
│ Blackboard: Fix login timeout bug and add regression tests        │
└────────────────────────────────────────────────────────────────────┘

┌─ Codex #1 ────────┐  ┌─ Claude #1 ───────┐
│ Status: running    │  │ Status: idle       │
│ Task: Fix bug      │  │ Task: —            │
└────────────────────┘  └────────────────────┘

┌─ Desk: Codex #1 ───────────────────────────────────────────────────┐
│ Current: editing src/auth/session.ts                                │
│ Task: Fix login timeout bug with minimum changes                    │
│ Files: M src/auth/session.ts, M src/auth/session.test.ts            │
│ Activity:                                                            │
│   [12:30:16] Runner started (codex exec)                             │
│   [12:30:45] Writing src/auth/session.ts...                          │
│   [12:31:02] Running tests...                                        │
└──────────────────────────────────────────────────────────────────────┘
```

**V1 简化说明**：
- 去掉 `A: agent` / `S: skill` 标签（registry 推迟）
- 去掉 `Hooks:` 行（hooks 推迟）
- Seat 状态只显示 6 态（idle/queued/running/done/failed/stopped），不显示细粒度状态
- Activity 简化为 transcript tail（最近 N 行）

完整版（包含 agent/skill/hooks）是原 Main Screen，推迟到 V1 之后。

## Seat Status（V1 版本）

V1 seat states:

- `idle`: empty / ready.
- `queued`: waiting for assignment.
- `running`: executing (黑盒进程运行中，不细分 reading/coding/testing).
- `done`: completed.
- `failed`: failed.
- `stopped`: stopped by user.

**推迟到 V1 之后的细粒度状态**（需要深度集成）：
- ~~`reading`~~: reading files or context.
- ~~`coding`~~: editing code.
- ~~`testing`~~: running or writing tests.
- ~~`reviewing`~~: reviewing another agent's output.
- ~~`checking`~~: checking risk, safety, edge cases.
- ~~`waiting_user`~~: raising hand, needs user action.
- ~~`blocked`~~: stuck.

## Color Rules（V1 版本）

~~Color is part of the product experience.~~ （完整配色体系推迟到 V1 之后）

V1 color rules:

- **Runner color** identifies the tool type:
  - Codex: 蓝色系
  - Claude: 橙色系
  - Gemini: 紫色系

**推迟到 V1 之后**：
- ~~Agent color identifies the role.~~
- ~~Skill color identifies the skill type.~~
- ~~Hook color identifies the hook type.~~
- ~~四色分类法（runner/agent/skill/hook）~~
- Skill color identifies the capability.
- Hook color identifies status/risk.

Suggested runner colors:

- Codex: cyan
- Claude Code: magenta
- Gemini: blue

Suggested hook status colors:

- pending: gray
- running: cyan
- success: green
- failed: red
- skipped: yellow
- waiting: magenta

Agent and skill colors come from registry metadata. If missing, AgentRoom assigns a stable color.

## Startup Experience

On startup, AgentRoom scans local tools:

- `codex --version`
- `claude --version`
- `gemini --version`

Startup behavior:

- Default: use the previous session's enabled runner choices.
- Press `s`: reselect which runner instances to start.

The user can start multiple instances of the same runner:

```text
Add Claude Code #1?
Add another Claude Code instance?
Add Codex #1?
Add another Codex instance?
```

Each instance becomes an independent classroom seat:

```text
Codex #1
Codex #2
Claude #1
Gemini #1
```

## Modes

### 1. Classroom Mode

This is the primary mode.

The user gives natural-language assignments to specific seats:

```text
@codex#1 修复登录超时 bug，尽量最小改动并补测试
@claude#1 帮我审查 @codex#1 的结果，重点看有没有回归风险
@gemini#1 看一下 @codex#1 和 @claude#1 的结果，有没有安全和边界问题
@codex#2 基于 @claude#1 的意见继续修改
```

There are no required fixed verbs like `implement` or `review`. AgentRoom only needs to parse:

- Target seat: `@codex#1`
- Referenced source seats: `@claude#1`, `@codex#1`
- User instruction text

AgentRoom may infer intent and skill, but the original instruction remains authoritative.

### 2. Flow Mode

Flow Mode is a convenience macro over Classroom Mode.

The user selects a flow, then assigns roles to seats:

```text
/flow bugfix "修复登录超时 bug"

implementer  -> Codex #1
reviewer     -> Claude #1
risk-checker -> Gemini #1
tester       -> Codex #2
```

The system remembers the last role assignment per flow. First run uses recommendations; later runs reuse the user's last choice but still allow editing.

Flow is not the product center. It is a repeatable dispatch shortcut.

## Agents, Skills, Hooks

AgentRoom has a unified registry for:

- Agents: roles, such as `implementer`, `reviewer`, `checker`.
- Skills: reusable capability packs, such as `bugfix`, `code-review`, `risk-check`.
- Hooks: lifecycle actions.

Registry sources:

1. Built-in public defaults.
2. User global config: `~/.agentroom`.
3. Project config: `.agentroom`.
4. Local tool configs from Codex, Claude Code, Gemini.

Merge priority:

```text
project > global > local tool config > builtin
```

When conflicts occur, the project-level item wins. The UI should show conflict sources.

## Agent and Skill Matching

Agents and skills are selected automatically from the user's description, but can be explicitly specified.

Examples:

```text
@codex#1 修复登录超时 bug
```

May auto-match:

- Agent: `implementer`
- Skill: `bugfix`

```text
@claude#1 作为 architect 使用 strict-review 审查 @codex#1
```

Should explicitly use:

- Agent: `architect`
- Skill: `strict-review`

Priority:

```text
explicit user selection > project rule > agent default > auto match > none
```

## Context and Memory

AgentRoom uses a mixed memory model:

- Fast summaries for hand-off.
- Evidence for important claims, risks, and decisions.
- Long-term memory only after user confirmation.

Memory layers:

- Runner transcript: each seat's private raw log.
- Blackboard: shared session context.
- Evidence: files, diffs, commands, test outputs, claims.
- Shared memory: summarized context for hand-offs.
- Project memory: approved project knowledge.
- User memory: approved personal preferences.

Important principle:

```text
Agent text is not fact. Important facts should be backed by evidence.
```

## Workspace Policy

Workspace mode is selected by assignment type:

- Read-only/review/check assignments can share the current workspace.
- Writing assignments should use isolated git worktrees when multiple writing instances may run.

This prevents multiple CLI instances from overwriting each other's changes.

## Frontend Extension

The TUI is the first client, not the core.

The core must expose state through frontend-friendly objects:

- `ClassroomView`
- `AgentRoomEvent`
- `ClassroomCommand`

Future Web UI should consume the same view/event/command model instead of reimplementing orchestration logic.

