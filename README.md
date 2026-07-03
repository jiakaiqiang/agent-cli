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
