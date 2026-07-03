# AgentRoom V1 执行进度

更新时间：2026-07-03

## 当前实现状态

| 任务 | 状态 | 证据 |
|---|---|---|
| 01-foundation | 已实现 | `package.json`、`tsconfig.json`、`src/types.ts` 已创建；`pnpm run typecheck` 通过 |
| 02-probe | 已实现并通过 Codex/Claude 真实验证 | `src/probe.ts` 已创建；fake runner probe 通过；提升权限真实 probe 中 Codex/Claude 无头 prompt 返回 `agentroom-probe-ok`；Gemini 当前不可用 |
| 03-storage | 已实现基础版 | `src/storage.ts` 已创建；session、events、seat state、transcript、summary、patch 已在 smoke 中落盘 |
| 04-runner-adapters | 已实现基础版 | `src/adapters/*` 已创建；支持 stdout/stderr 捕获、timeout、processId、stop 接口 |
| 05-corridor | 已通过 fake runner 验证 | `pnpm run dev:smoke-handoff` 内部先跑单座位；产出 `events.jsonl`、`summary.md`、`patch.diff` |
| 06-dispatch-contextpack | 已通过 fake runner 验证 | `src/smoke-handoff.ts` 验证第二座位 transcript 引用来源 patch 中的 `README.md` |
| 07-tui | 已实现基础版，已通过非交互 smoke | `src/tui/App.tsx` 与组件已创建；`pnpm run dev:tui-smoke` 可挂载并恢复最近 session；真实键盘交互仍待人工验证 |
| 08-control-acceptance | 部分实现，stop 已通过 fake runner 验证 | `src/recovery.ts`、`src/recover.ts`、`src/smoke-stop.ts` 已创建；`pnpm run dev:recover` 与 `pnpm run dev:smoke-stop` 通过；真实 CLI 长任务 stop 仍待人工验证 |
| CLI bin | 已实现并验证 | `src/cli.tsx` 与本地 `agentroom.cmd` 已创建；`pnpm run build` 生成 `dist/cli.js`；本地 `.\agentroom.cmd --help`、全局 `agentroom.cmd --help` 与 `agentroom.cmd probe` 通过 |

## 已执行验证

```bash
pnpm install
pnpm run typecheck
pnpm run build
```

结果：通过。

```bash
npm link
.\agentroom.cmd --help
agentroom.cmd --help
agentroom.cmd probe
```

结果：通过。PowerShell 当前禁止执行 npm 生成的 `agentroom.ps1`，因此在 Windows PowerShell 下使用 `agentroom.cmd`。

```bash
$fake=(Resolve-Path .\scripts\fake-runner.cmd).Path
$env:AGENTROOM_CODEX_BIN=$fake
$env:AGENTROOM_CLAUDE_BIN=$fake
pnpm run dev:smoke-handoff
```

结果：通过。最新成功会话示例：

```text
sess_20260703_183040_240
```

该会话证明：

- 第一座位生成 `summary.md`、`patch.diff`、`transcript.log`。
- 第二座位收到第一座位 ContextPack。
- 第二座位 transcript 中出现 `reviewed source patch: README.md`，证明交接内容被实际引用。

```bash
pnpm run dev:recover
```

结果：通过，当前无 stale running seat。

```bash
$env:AGENTROOM_CODEX_BIN=(Resolve-Path .\scripts\fake-runner.cmd).Path
pnpm run dev:smoke-stop
```

结果：通过。最新成功会话示例：

```text
sess_20260703_183055_777
```

该 smoke 证明：

- runner 正在运行时可以调用 `adapter.stop(seatId)`。
- 进程被 kill 后最终 seat state 保持为 `stopped`。
- stop 不再被 runner close 路径覆盖成 `failed`。

```bash
pnpm run dev:tui-smoke
```

结果：通过。TUI 能挂载、读取最近 session、显示双座位和 Desk 内容。

```bash
pnpm run dev:probe
```

提升权限运行结果：通过。最新真实 probe 示例：

```text
.agentroom/probe/2026-07-03T08-57-50-027Z
```

该 probe 证明：

- Codex CLI 版本：`codex-cli 0.142.5`
- Codex 无头 prompt：exit code 0，stdout `agentroom-probe-ok`
- Claude Code 版本：`2.1.199 (Claude Code)`
- Claude 无头 prompt：exit code 0，stdout `agentroom-probe-ok`
- Gemini：当前未安装 / 不在 PATH

## 当前真实 runner 状态

最近一次提升权限、未注入 fake runner 的 probe 结果：

- Codex：available，prompt 成功
- Claude：available，prompt 成功
- Gemini：unavailable

当前端到端 corridor/handoff 验证仍使用 `scripts/fake-runner.*`，因为 Gemini 不可用，且真实 runner 修改代码的行为需要更严格的人工确认。fake 验证证明 AgentRoom 编排、存储、ContextPack、worktree、runner 进程管理链路可运行；真实 probe 证明 Codex/Claude 的无头入口可被程序化驱动。

## 已知限制

- TUI 是基础版，已做非交互 smoke；尚未做人工键盘交互验收截图或录屏。
- `stop_seat` 接口和状态写入已通过 fake runner 长任务验证；真实 Codex/Claude 长任务 kill 仍需人工确认。
- Runner 命令模板已改为 stdin prompt：Codex 使用 `codex.cmd exec -`，Claude 使用 `claude.cmd -p`；Gemini 因未安装仍待确认。
- Worktree smoke 需要写 `.git/refs`，在受限沙箱内运行时需要提升权限。
- fake runner 通过 `AGENTROOM_RUNNER_PROMPT` 环境变量接收完整 prompt，用于规避 Windows `.cmd` 多行参数截断；真实 runner 仍使用 adapter 命令参数。
- Session id 已使用 `sess_YYYYMMDD_HHMMSS_mmm`，避免并发任务在同一秒创建 session 时互相覆盖。
- Windows PowerShell 下全局命令建议使用 `agentroom.cmd`，除非本机执行策略允许运行 npm 生成的 `agentroom.ps1`。
- 在仓库目录内也可以直接使用 `.\agentroom.cmd ...`，不依赖全局 npm link。
