# 02 - 三家 CLI 无头模式探测

## 目标

实测 Codex、Claude、Gemini 在 Windows 原生环境下的无头模式可用性，为 runner adapter 固化命令模板提供依据。

## 前置条件

- `01-foundation.md` 已完成。
- 本机已安装至少一个目标 CLI。
- 探测必须保留原始 stdout/stderr，不能只打印摘要。

## 任务清单

- [ ] 实现 `src/probe.ts` 的探测入口。
- [ ] 对每个 runner 执行版本探测：
  - `codex --version`
  - `claude --version`
  - `gemini --version`
- [ ] 为每个 runner 记录：
  - 是否安装
  - 版本输出
  - 退出码
  - stderr
  - 执行耗时
- [ ] 对每个已安装 runner 执行一个平凡无头 prompt。
- [ ] 分别记录无头 prompt 的：
  - 启动命令
  - stdout 原文
  - stderr 原文
  - exit code
  - 是否支持流式输出
  - 是否支持结构化输出
- [ ] 探测权限相关旗标：
  - 是否可关闭交互审批
  - 是否可限制写入范围
  - 是否可指定工作目录
- [ ] 将探测结果写入 `.agentroom/probe/<timestamp>/`。
- [ ] 为每个 runner 生成一份 `probe-result.json`。
- [ ] 在终端输出简短探测摘要。

## 交付物

- `src/probe.ts`
- `.agentroom/probe/<timestamp>/codex/probe-result.json`
- `.agentroom/probe/<timestamp>/claude/probe-result.json`
- `.agentroom/probe/<timestamp>/gemini/probe-result.json`
- 原始 stdout/stderr 日志

## 验收标准

- [ ] `tsx src/probe.ts` 可在 Windows PowerShell 中运行。
- [ ] 未安装的 runner 被标记为 unavailable，不导致整个 probe 失败。
- [ ] 已安装 runner 的版本、exit code、stdout/stderr 被完整落盘。
- [ ] 至少一个 runner 的无头 prompt 成功执行。
- [ ] 探测结果足够支持 `04-runner-adapters.md` 固化命令模板。

## 不做

- 不实现正式派发。
- 不创建 worktree。
- 不做 TUI 展示。

