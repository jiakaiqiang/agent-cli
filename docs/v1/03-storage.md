# 03 - 会话目录、事件日志与座位文件

## 目标

实现 V1 的文件存储层。所有会话状态、事件、座位产物都必须落到 `.agentroom/sessions/`，为 corridor、TUI 和恢复能力提供统一数据源。

## 前置条件

- `01-foundation.md` 已完成。
- V1 类型已定义。

## 任务清单

- [ ] 实现 `src/storage.ts`。
- [ ] 实现 session id 生成：
  - 格式：`sess_YYYYMMDD_HHMMSS_mmm`
  - 毫秒后缀用于避免并发任务在同一秒创建 session 时碰撞
- [ ] 创建 session 目录：
  - `.agentroom/sessions/<session-id>/`
- [ ] 创建座位目录：
  - `.agentroom/sessions/<session-id>/seats/<seat-id>/`
- [ ] 实现 `events.jsonl` append 写入。
- [ ] 实现 `events.jsonl` 读取与重放。
- [ ] 实现 seat `state.json` 写入与读取。
- [ ] 实现 seat `transcript.log` append 写入。
- [ ] 实现 seat `summary.md` 写入与读取。
- [ ] 实现 seat `patch.diff` 写入与读取。
- [ ] 实现 artifacts 目录创建。
- [ ] 实现最近 session 查找。
- [ ] 对 JSONL 写入做最小错误处理：
  - 写入失败时返回明确错误
  - 不吞掉异常

## 交付物

- `src/storage.ts`
- `.agentroom/sessions/<session-id>/events.jsonl`
- `.agentroom/sessions/<session-id>/seats/<seat-id>/state.json`
- `.agentroom/sessions/<session-id>/seats/<seat-id>/transcript.log`

## 验收标准

- [ ] 可创建一个新 session。
- [ ] 可为 session 创建 `codex-1`、`claude-1` 等座位目录。
- [ ] 可追加并读取 `events.jsonl`。
- [ ] 可写入并读取 `state.json`。
- [ ] 可写入并读取 `summary.md` 与 `patch.diff`。
- [ ] 重启进程后可通过文件恢复最近 session 的基本状态。

## 不做

- 不实现 `blackboard.json`。
- 不实现 `evidence/`。
- 不实现全局 `~/.agentroom` 配置。
- 不实现 memory。
