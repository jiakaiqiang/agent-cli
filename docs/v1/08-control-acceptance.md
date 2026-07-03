# 08 - 控制、恢复与 V1 验收

## 目标

补齐 V1 的基础控制能力和最终验收路径，包括 stop seat、失败恢复、会话恢复和端到端 demo。

## 前置条件

- `07-tui.md` 已完成。
- 至少一个 runner adapter 能执行真实任务。

## 任务清单

- [ ] 在 Controller 中实现 `stop_seat` 命令。
- [ ] TUI 为当前选中座位提供 stop 快捷键。
- [ ] stop 时调用 RunnerAdapter `stop()`。
- [ ] stop 后写入 `seat.state_changed`，状态为 `stopped`。
- [ ] stop 后保留 transcript、worktree、summary、patch。
- [ ] 启动 TUI 时读取最近 session。
- [ ] 从 `events.jsonl` 重建基础 ClassroomView。
- [ ] 从 seat `state.json` 恢复座位状态。
- [ ] 对 `running` 但进程不存在的座位做保守恢复：
  - 标记为 `failed` 或 `stopped`
  - 写入恢复事件
- [ ] 对损坏的 JSONL 行做容错：
  - 跳过坏行
  - 保留错误提示
- [ ] 编写 V1 端到端手动验收脚本。
- [ ] 记录每个 runner 的 probe 结论和已知限制。

## 端到端验收场景

### 场景 A：单座位走廊

```bash
tsx src/corridor.ts "对 README 做一个最小修改"
```

期望：

- 生成 `.agentroom/sessions/<session-id>/events.jsonl`
- 生成 seat `summary.md`
- 生成 seat `patch.diff`
- 生成 seat `transcript.log`

### 场景 B：双座位交接

```text
@codex#1 修复一个小问题并写 summary
@claude#1 审查 @codex#1 的结果，指出 diff 中的具体风险
```

期望：

- Claude 的 ContextPack 包含 Codex 的 `summary.md` 与 `patch.diff`
- Claude 输出实际引用 Codex diff 的具体文件或修改点

### 场景 C：TUI 教室

```bash
tsx src/tui/App.tsx
```

期望：

- 同屏显示至少两个座位
- 可切换选中座位
- 可输入 `@seat` 派发
- 可 stop 运行中座位
- DeskPanel 显示活动、变更文件、summary、错误

### 场景 D：恢复

1. 启动 TUI 并派发任务。
2. 退出 TUI。
3. 重新启动 TUI。

期望：

- 最近 session 可恢复。
- seat 状态、summary、transcript tail 可查看。

## V1 最终验收清单

- [ ] Windows 原生可运行。
- [ ] 不依赖 tmux、WSL 或 PTY。
- [ ] `tsx src/probe.ts` 能探测三家 CLI 或明确报告不可用。
- [ ] `tsx src/corridor.ts "task"` 能跑通单座位闭环。
- [ ] 单座位闭环产出 `events.jsonl`、`summary.md`、`patch.diff`。
- [ ] 双座位 ContextPack 交接成功。
- [ ] TUI 同屏显示至少两个座位。
- [ ] TUI 至少包含两家不同 runner。
- [ ] TUI 支持 `@seat` 派发。
- [ ] TUI 支持 stop。
- [ ] 失败路径可演示并保留 transcript。
- [ ] 最近 session 可恢复。

## 不做

- 不实现自动 worktree 清理。
- 不实现会话导出。
- 不实现 replay。
- 不实现 claim verification。

