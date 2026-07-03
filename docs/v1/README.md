# AgentRoom V1 执行任务总览

本文档集基于 `docs/agentroom-system-design.md` 拆分 V1 可执行任务。V1 的交付范围固定为：黑盒无头进程 + 多工具同屏教室 TUI。Registry、hooks、flow、memory、claim verification 不进入 V1。

## 执行顺序

1. [01-foundation.md](01-foundation.md) - 项目脚手架与核心类型
2. [02-probe.md](02-probe.md) - 三家 CLI 无头模式探测
3. [03-storage.md](03-storage.md) - 会话目录、事件日志与座位文件
4. [04-runner-adapters.md](04-runner-adapters.md) - 通用 runner 与三家 adapter
5. [05-corridor.md](05-corridor.md) - 单座位走廊闭环
6. [06-dispatch-contextpack.md](06-dispatch-contextpack.md) - `@seat` 派发解析与 ContextPack
7. [07-tui.md](07-tui.md) - Ink 教室 TUI
8. [08-control-acceptance.md](08-control-acceptance.md) - stop、恢复、V1 验收

当前执行进度见 [progress.md](progress.md)。

## V1 完成定义

- Windows 原生环境可运行，不依赖 tmux、WSL 或 PTY。
- `tsx src/probe.ts` 可探测 Codex、Claude、Gemini。
- `tsx src/corridor.ts "task"` 可完成单座位派发并生成 `events.jsonl`、`summary.md`、`patch.diff`。
- 第二个座位可通过 ContextPack 接收第一个座位的 summary 与 diff。
- Ink TUI 同屏显示至少两个座位，且至少来自两家 runner。
- TUI 支持 `@seat` 派发、座位切换、状态实时更新与 stop。
- 会话状态持久化在 `.agentroom/sessions/`，重启后可恢复最近视图。

## 任务状态标记

每个任务使用以下状态：

- `[ ]` 未开始
- `[~]` 进行中
- `[x]` 已完成
- `[!]` 阻塞，需要明确原因
