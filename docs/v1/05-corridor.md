# 05 - 单座位走廊闭环

## 目标

实现 V1 的第一条主路径：用户输入任务后，AgentRoom 创建隔离 worktree，启动一个 runner 执行，回收 diff 与 summary，并写入 session 目录。

## 前置条件

- `03-storage.md` 已完成。
- `04-runner-adapters.md` 至少有一个 adapter 可用。
- 当前项目是 git 仓库。

## 任务清单

- [ ] 实现 `src/corridor.ts` 的真实入口。
- [ ] 从 argv 读取用户任务文本。
- [ ] 创建 session。
- [ ] 创建默认 seat，例如 `codex-1` 或通过参数指定。
- [ ] 派发前检查 git 工作区状态。
- [ ] 创建 worktree：
  - 建议路径：`.agentroom/worktrees/<session-id>/<seat-id>/`
- [ ] 将摘要契约写入 runner prompt。
- [ ] 调用对应 RunnerAdapter 执行。
- [ ] 执行完成后运行 `git diff` 并写入 `patch.diff`。
- [ ] 执行完成后运行 `git diff --stat` 并用于摘要兜底。
- [ ] 从 worktree 根目录回收 `AGENTROOM_SUMMARY.md`。
- [ ] 如果 runner 未生成 summary，调用确定性兜底摘要器。
- [ ] 写入 seat `summary.md`。
- [ ] 写入最终 `state.json`。
- [ ] 保留失败现场，不自动删除 worktree。
- [ ] 在终端输出 session 路径与 seat 产物路径。

## 交付物

- `src/corridor.ts`
- 单座位 session 目录
- `summary.md`
- `patch.diff`
- `transcript.log`
- `events.jsonl`

## 验收标准

- [ ] `tsx src/corridor.ts "update README"` 能创建新 session。
- [ ] runner 能在 worktree 内执行。
- [ ] 执行结束后生成 `patch.diff`。
- [ ] 执行结束后生成 `summary.md`。
- [ ] runner 不写 `AGENTROOM_SUMMARY.md` 时仍有兜底 summary。
- [ ] 超时或非 0 退出时状态为 `failed`，并保留 transcript。
- [ ] 成功路径不破坏主工作区。

## 不做

- 不实现多座位。
- 不实现 TUI。
- 不自动清理 worktree。
- 不实现 claim verification。

