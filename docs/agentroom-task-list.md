# AgentRoom Executable Task List

> **2026-07-03 更新**：本文档已按批准设计（design/agentroom-design-approved.md）重排。V1 = 走廊（黑盒无头进程）+ 多工具同屏教室 TUI。Hooks/registry/flow/memory 推迟到 V1 之后。

This file turns the product and architecture design into implementable tasks.

## Phase 0: Decisions（V1 精简）

- [ ] Choose package manager: pnpm（推荐）
- [ ] Choose process library: execa（推荐）
- [ ] Choose TUI library: Ink
- [ ] ~~Choose CLI library~~ —— V1 可直接 `tsx` 运行，完整 CLI 框架推迟
- [ ] ~~Pick binary name~~ —— V1 推迟

**V1 不需要**：
- CLI 框架（commander/clipanion）推迟
- 二进制打包推迟

## 阶段 1：走廊（Phase 1–3 精简 + Phase 7–8 前置）

### Phase 1-精简：最小脚手架

- [ ] Create `package.json`（dependencies: execa, tsx）
- [ ] Add `tsconfig.json`
- [ ] Add `src/probe.ts`（三家 CLI 无头模式探测实验）
- [ ] Add `src/corridor.ts`（单座位派发 → worktree 执行 → 回收）
- [ ] Add `src/types.ts`（Assignment / ContextPack / AgentRoomEvent 子集）

Acceptance command:

```bash
tsx src/probe.ts
# 输出：三家 CLI 的原始 stdout/stderr 落盘
# 确认：Windows 原生可用、权限旗标、退出码语义
```

### Phase 2-精简：V1 核心类型

- [ ] Define `RunnerType`（"codex" | "claude" | "gemini"）
- [ ] Define `SeatState`（6 态：idle/queued/running/done/failed/stopped）
- [ ] Define `SeatView`（去掉 agent/skill/needsUser）
- [ ] Define `Assignment`（去掉 agent/skill 推断）
- [ ] Define `ContextPack`（核心：userInstruction + sourceSeats）
- [ ] Define `AgentRoomEvent`（去掉 hook.* 事件）

**V1 不需要**：
- `ClassroomView` 完整版（推迟）
- `ClassroomCommand` 完整版（推迟）
- Registry types（推迟）
- Hook types（推迟）
- Blackboard/Memory types（推迟）

Files:

```text
src/types.ts
```

### Phase 3-精简：会话文件存储（只做走廊需要的部分）

- [ ] Implement session id generator
- [ ] Create session directory：`.agentroom/sessions/sess_*/`
- [ ] Append/read `events.jsonl`
- [ ] Write/read per-seat `state.json`
- [ ] Write/read per-seat `patch.diff`
- [ ] Write/read per-seat `summary.md`

**V1 不需要**：
- Global `~/.agentroom` 配置（推迟）
- `classroom.json`（推迟）
- `blackboard.json`（推迟）

Files:

```text
src/storage.ts
```

Acceptance command:

```bash
tsx src/corridor.ts "fix login timeout"
# 输出：.agentroom/sessions/<id>/seats/<seat>/{state.json, patch.diff, summary.md}
# 输出：.agentroom/sessions/<id>/events.jsonl
```

### Phase 7-前置：Runner Execution（黑盒无头进程）

- [ ] Implement `src/adapters/runner.ts`（通用子进程管理）
  - spawn + 管道读 stdout/stderr
  - 超时 kill（默认 10 分钟）
  - 退出码捕获
- [ ] Implement `src/adapters/codex.ts`（Codex 启动命令模板，probe 后确认）
- [ ] Implement `src/adapters/claude.ts`（Claude 启动命令模板）
- [ ] Implement `src/adapters/gemini.ts`（Gemini 启动命令模板）
- [ ] Implement worktree 创建/切换/脏检测
- [ ] Implement 座位状态机（queued → running → done/failed）

Files:

```text
src/adapters/runner.ts
src/adapters/codex.ts
src/adapters/claude.ts
src/adapters/gemini.ts
```

Acceptance:

```bash
tsx src/corridor.ts "add test for session cleanup"
# 验证：进程启动、stdout 捕获、退出码记录
# 验证：超时能正常 kill
```

### Phase 8-前置：Artifact Collection

- [ ] 派发结束后执行 `git diff` → `patch.diff`
- [ ] 派发结束后执行 `git diff --stat`
- [ ] 从 worktree 根收集 `AGENTROOM_SUMMARY.md` → 座位 `summary.md`
- [ ] 实现确定性兜底摘要器（diffstat + 文件清单 + 退出码）
- [ ] 实现 `src/contextpack.ts`（ContextPack 组装）

Files:

```text
src/contextpack.ts
```

Acceptance:

```bash
# 第一座位
tsx src/corridor.ts "fix bug"
# 第二座位（引用第一座位）
tsx src/corridor.ts "@seat1 review @seat1's result"
# 验证：第二座位的 ContextPack 包含第一座位的 diff + summary
# 验证：第二座位输出实际引用了第一座位 diff 的具体内容
```

**阶段 1 完成线**：
- ✅ `tsx src/probe.ts` 确认三家 CLI 在 Windows 原生可用
- ✅ `tsx src/corridor.ts "task"` 单座位跑通
- ✅ 双座位交接 demo 成功

## 阶段 2：教室（Phase 5 + Phase 6 部分 + Phase 12 部分）

### Phase 5：TUI Classroom View

- [ ] Implement `src/tui/App.tsx`（Ink + React）
- [ ] Implement `src/tui/SeatCard.tsx`（座位卡片）
  - 显示 runner type（颜色区分）
  - 显示状态（6 态）
  - 显示当前任务
- [ ] Implement `src/tui/DeskPanel.tsx`（座位详情）
  - 活动日志 tail（transcript 最近 N 行）
  - 变更文件列表
  - 当前 summary 显示
- [ ] Implement blackboard header（会话标题 + 运行时间）
- [ ] Implement keyboard navigation（left/right 切换座位）
- [ ] Implement events.jsonl 实时 tail → 更新 TUI

Files:

```text
src/tui/App.tsx
src/tui/SeatCard.tsx
src/tui/DeskPanel.tsx
src/tui/BlackboardHeader.tsx
```

Acceptance:

```bash
tsx src/tui/App.tsx
# 验证：TUI 启动，同屏显示 ≥2 座位（至少两家工具：Codex #1、Claude #1）
# 验证：left/right 键切换座位
# 验证：Desk 面板显示选中座位的详情
# 验证：座位颜色按 runner type 区分
```

### Phase 6-部分：自然语言派发（只做解析，不做推断）

- [ ] Implement dispatch 解析器（`@seat` 目标 + 来源引用 + 原文指令）
- [ ] 解析 `@codex#1 task` → Assignment（target: codex#1, instruction: "task"）
- [ ] 解析 `@claude#1 review @codex#1` → Assignment（target: claude#1, sources: [codex#1]）
- [ ] ~~Implement agent/skill 自动推断~~ —— V1 推迟

Files:

```text
src/dispatch-parser.ts
```

Acceptance:

```bash
# TUI 中输入：
@codex#1 修复登录超时 bug
@claude#1 审查 @codex#1
# 验证：Assignment 创建正确，target/sources 解析成功
```

### Phase 12-部分：基础控制

- [ ] Implement stop seat 命令（kill 进程、标记 stopped）
- [ ] TUI 中显示失败座位的错误信息（transcript log + error message）
- [ ] ~~Worktree 自动清理~~ —— V1 手动触发
- [ ] ~~会话导出~~ —— V1 推迟

Acceptance:

```bash
# TUI 中运行一个长任务，按 stop 快捷键
# 验证：进程被 kill，座位状态变为 stopped
# 验证：失败座位的 desk 面板显示错误信息
```

**阶段 2 完成线**：
- ✅ Ink TUI 同屏显示 ≥2 座位（至少两家工具）
- ✅ 可 `@派发`、可 stop
- ✅ 座位状态实时更新
- ✅ Desk 面板显示详情（活动日志、变更文件、summary）

## V1 完成线

当以下全部达成，V1 交付：

- ✅ 阶段 1 完成线（走廊跑通 + 双座位交接）
- ✅ 阶段 2 完成线（教室 TUI）
- ✅ 会话状态持久化在 `.agentroom/sessions/`，可恢复

## 推迟到 V1 之后

以下 Phase 在批准设计中明确推迟，不进 V1：

- **Phase 4: Runner Probing**（完整版探测 + 启动选择 UI）→ V1 只有 probe.ts 实验
- **Phase 6: Registry Loading**（agents/skills/hooks/flows 全量）→ 推迟
- **Phase 9: Hook Runtime**（shell/JS/Python/approval 四运行时）→ 推迟
- **Phase 10: Blackboard and Memory**（完整版）→ 阶段 3a 最小版，memory 审批推迟
- **Phase 11: Flow Mode**（role-to-seat 宏）→ 推迟
- **Phase 12 剩余**（worktree 自动清理、会话导出）→ 推迟
- **Phase 13: Runner Config Import**（三家工具本地配置导入）→ 推迟（即原 M3/P6 漂移点）
- **Phase 14: Advanced Hook Features**（条件 hook、hook 链）→ 推迟
- **Phase 15–17**（若存在）→ 推迟

## Next Actions（按批准设计 Next Steps）

1. **改 docs/ 四份文档** ✅（当前正在进行）
2. **写 `src/probe.ts`**（~半天）
3. **写 `src/corridor.ts`**（~半天）
4. **写 `src/contextpack.ts`**（~半天）
5. **写 `src/tui/App.tsx` + 组件**（~1 天）
6. **合规率实测**（每 CLI ≥10 次、共 ≥30 次派发）
