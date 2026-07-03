# 04 - 通用 Runner 与三家 Adapter

## 目标

实现 runner adapter 层，把 Codex、Claude、Gemini 都封装为统一的黑盒无头进程接口。

## 前置条件

- `02-probe.md` 已完成，已获得每家 CLI 的实测命令模板。
- `03-storage.md` 已完成，能写入 transcript 与 events。

## 任务清单

- [ ] 创建 `src/adapters/runner.ts`。
- [ ] 定义 `RunnerAdapter` 接口：
  - `probe()`
  - `run()`
  - `stop()`
- [ ] 定义 `RunnerRunContext`：
  - `sessionId`
  - `seatId`
  - `cwd`
  - `timeoutMs`
  - `storage`
- [ ] 实现通用子进程启动能力。
- [ ] 实现 stdout/stderr 流式捕获。
- [ ] 将 stdout/stderr 追加到座位 `transcript.log`。
- [ ] 将关键输出追加为 `activity.appended` 事件。
- [ ] 实现默认超时：
  - 默认 10 分钟
  - 超时后 kill 进程树
- [ ] 捕获 exit code 与 signal。
- [ ] 将 `queued -> running -> done/failed/stopped` 状态写入 events。
- [ ] 创建 `src/adapters/codex.ts`。
- [ ] 创建 `src/adapters/claude.ts`。
- [ ] 创建 `src/adapters/gemini.ts`。
- [ ] 每个 adapter 从 probe 结果固化命令模板。
- [ ] 每个 adapter 支持指定工作目录执行。
- [ ] 每个 adapter 的 prompt 包含摘要契约说明。

## 交付物

- `src/adapters/runner.ts`
- `src/adapters/codex.ts`
- `src/adapters/claude.ts`
- `src/adapters/gemini.ts`
- 可运行的 runner smoke test

## 验收标准

- [ ] 至少一个 adapter 可执行真实无头任务。
- [ ] stdout/stderr 被写入对应 seat 的 `transcript.log`。
- [ ] 进程成功退出时 seat 状态变为 `done`。
- [ ] 进程非 0 退出时 seat 状态变为 `failed`。
- [ ] 超时任务会被 kill，状态变为 `failed`。
- [ ] 用户 stop 时进程被 kill，状态变为 `stopped`。

## 不做

- 不解析 agent 内部细粒度状态。
- 不实现 `waiting_user`。
- 不自动执行 runner 输出中的命令。

