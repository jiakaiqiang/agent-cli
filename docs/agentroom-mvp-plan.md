# AgentRoom MVP Plan

> **2026-07-03 更新**：本文档已按批准设计（design/agentroom-design-approved.md）重排。V1 = 走廊（黑盒无头进程）+ 多工具同屏教室 TUI。hooks/registry/flow/memory 推迟到 V1 之后。

## V1 Goal（重新定义，2026-07-03）

Build a local TypeScript CLI/TUI prototype that can:

1. **走廊（阶段 1）**：黑盒无头进程驱动单个 CLI 座位，worktree 隔离执行，产出 diff + summary。
2. **教室（阶段 2）**：Ink TUI 同屏显示 ≥2 个座位（至少两家不同工具），接受 `@seat` 派发，座位间可交接 context pack（diff + summary）。
3. Store all session state in local files, no database.
4. Native Windows support (no tmux/WSL dependency).

## V1 Non-Goals（按批准设计更新）

- No Web UI.
- No database.
- **No registry system** (agents/skills 推迟，V1 不做 agent/skill 自动推断).
- **No hooks system** (shell/JS/Python/approval 四运行时全部推迟).
- **No flow mode** (role-to-seat 宏推迟).
- **No memory approval queue** (blackboard 最小版归阶段 3a，memory 审批推迟).
- **No claim verification / referee system** (阶段 3a/3b，V1 之后的护城河).
- No plugin marketplace.
- No automatic multi-agent merge.

## V1 Milestones（重排，2026-07-03）

### 阶段 1：走廊（Milestone 1–4 精简 + M7–8 前置）

**目标**：验证生死题 —— 三家 CLI 能被无头进程驱动、Windows 原生可用、能产出可交接的 diff + summary。

#### M1-简化：最小脚手架

Deliverables:
- `package.json` + `tsconfig.json`
- `src/probe.ts`（三家 CLI 无头模式实验）
- `src/corridor.ts`（单座位派发 → worktree 执行 → 回收）
- `src/types.ts`（Assignment / ContextPack / 事件子集）

Acceptance:
- `tsx src/probe.ts` 在 Windows 原生成功驱动三家 CLI 无头模式，落盘原始输出
- 确认各家权限旗标、退出码语义、是否有结构化输出（如 `claude -p --output-format stream-json`）

#### M2-合并到M1：探测即 probe.ts 的一部分

#### M3-推迟：Registry Loading（agents/skills/hooks/flows 全部推迟）

#### M4-精简：会话文件存储（只做走廊需要的部分）

Deliverables:
- `.agentroom/sessions/sess_*/` 目录结构
- `events.jsonl` 写入/读取
- `seats/<seat>/{state.json, patch.diff, summary.md}` 子集

Acceptance:
- `tsx src/corridor.ts "fix X"` 产出 `.agentroom/sessions/<id>/seats/<seat>/{patch.diff, summary.md}` + `events.jsonl`
- 超时、脏 worktree 两条失败路径可演示

#### M7-前置：Runner Execution（黑盒无头进程）

Deliverables:
- `src/adapters/runner.ts`（通用子进程管理：spawn、管道读输出、超时 kill）
- 三家 CLI 的启动命令模板（probe 后确认）
- 座位状态机简化版：`queued -> running -> done/failed`

Acceptance:
- 单次派发能启动、捕获 stdout/stderr、记录退出码
- 进程超时能正常 kill

#### M8-前置：Artifact Collection

Deliverables:
- 派发结束后执行 `git diff` / `git diff --stat` 到 `patch.diff`
- 从 worktree 根收集 `AGENTROOM_SUMMARY.md` → 座位 `summary.md`
- 确定性兜底摘要器（diffstat + 文件清单 + 退出码 + 可选的结构化输出事件）

Acceptance:
- 第二座位派发时，ContextPack 包含第一座位的 diff + summary
- 第二座位输出实际引用了第一座位 diff 的具体内容

### 阶段 2：教室（M5 + M6 部分 + M12 部分）

**目标**：多工具同屏的单 CLI 教室 TUI 跑起来（product-spec Main Screen）。

#### M5：TUI Classroom View

Deliverables:
- `src/tui/App.tsx`（Ink + React）
- Blackboard header（会话标题 + 运行时间）
- Seat row（≥2 座位卡片，显示 runner type / 状态 / 当前任务）
- Desk panel（选中座位的详情：活动日志 tail、变更文件、当前 summary）
- Keyboard navigation（left/right 切换座位）

Acceptance:
- TUI 启动，同屏显示 ≥2 座位（至少两家不同工具：如 Codex #1、Claude #1）
- 实时 tail `events.jsonl` 更新座位状态
- 座位颜色按 runner type 区分

#### M6-部分：自然语言派发（只做解析，不做推断）

Deliverables:
- 解析 `@seat` 目标
- 解析 `@seat` 来源引用（用于 ContextPack）
- 保留原文指令
- **不做** agent/skill 自动推断（推迟）

Acceptance:
- 输入 `@codex#1 修复 bug` → 创建 Assignment（target: codex#1, instruction: "修复 bug"）
- 输入 `@claude#1 审查 @codex#1` → 创建 Assignment（target: claude#1, sources: [codex#1], instruction: "审查 @codex#1"）

#### M12-部分：基础控制

Deliverables:
- Stop seat 命令（kill 进程、标记 `stopped`）
- Worktree 清理命令（手动触发，V1 不自动）
- 失败座位状态可检视（transcript log、error message）

Acceptance:
- TUI 中可 stop 正在运行的座位
- 失败座位的 desk 面板显示错误信息

### V1 完成线

当以下全部达成，V1 交付：

- ✅ `tsx src/probe.ts` 确认三家 CLI 在 Windows 原生可用
- ✅ `tsx src/corridor.ts "task"` 单座位跑通（派发 → worktree → diff + summary）
- ✅ 双座位交接 demo（座位 2 的输出引用了座位 1 的 diff）
- ✅ Ink TUI 同屏显示 ≥2 座位（至少两家工具），可 `@派发`、可 stop
- ✅ 会话状态持久化在 `.agentroom/sessions/`，可恢复

### 推迟到 V1 之后（原 M3 / M9 / M10 / M11 / M12 部分）

以下功能在批准设计中明确推迟，不进 V1：

- **M3 Registry Loading**（agents/skills/hooks/flows 全量，含 builtin 与三家工具导入）→ 阶段 3 之后评估
- **M9 Hook Runtime**（shell/JS/Python/approval 四运行时）→ 阶段 3 之后评估
- **M10 Blackboard & Memory**（blackboard 最小版归阶段 3a；memory 审批队列推迟）→ 阶段 3 之后评估
- **M11 Flow Mode**（role-to-seat 宏）→ 阶段 3 之后评估
- **M12 部分**（worktree 自动清理策略、会话导出）→ 阶段 3 之后评估
- **配色体系完整版**（四色分类法）→ V1 只按 runner type 区分颜色

## V1 First Demo Scenario（更新，2026-07-03）

启动 AgentRoom TUI：

```bash
tsx src/tui/App.tsx
```

TUI 显示两个座位：
```
┌─ AgentRoom ─ Session abc123 ─ 00:00:15 ───────────────┐
│ Blackboard: 2 seats active                             │
└────────────────────────────────────────────────────────┘

┌─ Codex #1 ───────┐  ┌─ Claude #1 ──────┐
│ Status: running   │  │ Status: idle      │
│ Task: 修复 bug     │  │ Task: —           │
└───────────────────┘  └───────────────────┘

┌─ Desk: Codex #1 ─────────────────────────────────────┐
│ Activity:                                             │
│ [12:30:15] Assignment queued                          │
│ [12:30:16] Runner started (codex exec)                │
│ [12:30:45] Writing src/auth/session.ts...             │
│                                                       │
│ Changed files: (none yet)                             │
└───────────────────────────────────────────────────────┘
```

派发命令（通过 TUI 输入或 CLI）：

```bash
# 第一座位
@codex#1 修复登录超时 bug，最小改动并补测试

# 第二座位（引用第一座位结果）
@claude#1 审查 @codex#1 的结果，重点看回归风险
```

预期结果：

- Codex #1 座位状态变为 `running` → `done`
- Desk 面板显示 Codex transcript、变更文件列表
- `.agentroom/sessions/<id>/seats/codex-1/` 下有 `patch.diff` + `summary.md`
- Claude #1 派发时，ContextPack 包含 Codex 的 diff + summary
- Claude 输出中实际引用了 Codex diff 的具体内容（验证交接成功）

**不在 V1 范围**：
- 不会有 agent/skill 标签（registry 推迟）
- 不会有 hook 执行（推迟）
- 不会有 blackboard 更新（最小版在阶段 3a）
- 不会有 memory 候选确认（推迟）
- 不会有 claim verification（阶段 3a）

