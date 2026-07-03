# 06 - `@seat` 派发解析与 ContextPack

## 目标

实现教室模式的派发解析和座位间交接。V1 只解析目标座位、来源座位和原始指令，不做 agent/skill/intent 推断。

## 前置条件

- `05-corridor.md` 已完成。
- session 目录中已有至少一个座位产物。

## 任务清单

- [ ] 实现 `src/dispatch-parser.ts`。
- [ ] 解析目标座位：
  - `@codex#1`
  - `@claude#1`
  - `@gemini#1`
- [ ] 将用户输入转换为 seat id：
  - `@codex#1` -> `codex-1`
- [ ] 解析来源座位引用。
- [ ] 支持一个目标座位和多个来源座位。
- [ ] 保留原始指令文本。
- [ ] 对缺少目标座位的输入返回明确错误。
- [ ] 对不存在的来源座位返回明确错误。
- [ ] 实现 `src/contextpack.ts`。
- [ ] 从来源座位读取：
  - `summary.md`
  - `patch.diff`
  - 变更文件清单
  - artifacts
- [ ] 组装 `ContextPack`。
- [ ] 将 ContextPack 注入 runner prompt。
- [ ] 支持双座位交接 demo：
  - `@codex#1 修复一个小问题`
  - `@claude#1 审查 @codex#1 的结果`

## 交付物

- `src/dispatch-parser.ts`
- `src/contextpack.ts`
- 双座位交接 demo 脚本或命令说明

## 验收标准

- [ ] `@codex#1 修复 bug` 可解析为 target `codex-1`。
- [ ] `@claude#1 审查 @codex#1` 可解析为 target `claude-1`、source `codex-1`。
- [ ] ContextPack 包含来源座位的 summary。
- [ ] ContextPack 包含来源座位的 diff。
- [ ] 第二个座位输出中能实际引用第一个座位 diff 的具体内容。
- [ ] 错误输入不会静默失败。

## 不做

- 不实现自然语言 intent 推断。
- 不自动选择 agent 或 skill。
- 不实现 flow 宏。

