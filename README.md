# agent-cli

AgentRoom 本地编排工具文档仓库。

## 本地命令行使用

构建：

```bash
pnpm install
pnpm run build
```

在当前项目目录直接使用：

```powershell
.\agentroom.cmd --help
.\agentroom.cmd probe
.\agentroom.cmd tui
```

如果希望在任意目录使用，链接到全局命令：

```bash
npm link
```

使用命令：

```bash
agentroom.cmd probe
agentroom.cmd run --runner codex --allow-dirty "update README"
agentroom.cmd tui
agentroom.cmd recover
```

Windows PowerShell 如果提示禁止运行 `agentroom.ps1`，直接使用 npm 生成的 cmd 入口：

```powershell
agentroom.cmd probe
agentroom.cmd tui
```

开发时也可以不构建，直接运行源码入口：

```bash
pnpm agentroom probe
pnpm agentroom tui
```

## 上下文管理

AgentRoom 使用独立的 `src/collab/` 模块统一管理座位上下文，与业务代码解耦：

- **每座位维护一份索引** `context-index.json` — 记录该 seat 的 summary / patch / transcript / artifact 条目引用
- **协作时开临时上下文池** `collabs/<id>/manifest.json` — 存哪些条目参与本次协作
- **座位派发只带自己的历史**（不再自动引用自己），派发引用 `@其他座位` 时自动开池 → 派发结束自动归档

### TUI 命令：`/clear`

在座位详情页输入 `/clear`（或 `/clear-context`）：

- 清空该 seat 的 context-index（entries 归零）
- 从所有 open 的协作池中移除该 seat 的引用
- **保留** `summary.md` / `patch.diff` / `transcript.log` 磁盘文件（审计与手动恢复用）
- **保留** worktree 目录（文件不删）
- 追加 `context.seat_cleared` 事件到 `events.jsonl`

语义对齐 Claude Code / Codex CLI：清对话记忆，保留磁盘产物。

