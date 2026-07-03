# 07 - Ink 教室 TUI

## 目标

实现 V1 教室界面：同屏显示多个座位、选中座位详情、事件实时刷新，并支持 `@seat` 派发。

## 前置条件

- `03-storage.md` 已完成。
- `06-dispatch-contextpack.md` 已完成。
- 至少有两个可展示座位，且最好来自不同 runner。

## 任务清单

- [ ] 创建 `src/tui/App.tsx`。
- [ ] 创建 `src/tui/BlackboardHeader.tsx`。
- [ ] 创建 `src/tui/SeatCard.tsx`。
- [ ] 创建 `src/tui/DeskPanel.tsx`.
- [ ] 渲染 session id、会话标题、运行时间。
- [ ] 渲染所有 seat cards。
- [ ] SeatCard 显示：
  - runner 类型
  - seat 名称
  - 6 态状态
  - 当前任务
- [ ] 按 runner 类型区分颜色：
  - Codex：青色或蓝色系
  - Claude：橙色或洋红色系
  - Gemini：紫色或蓝色系
- [ ] DeskPanel 显示：
  - 当前任务
  - transcript tail
  - 变更文件
  - summary
  - 错误信息
- [ ] 支持左右方向键切换座位。
- [ ] 支持输入 `@seat instruction`。
- [ ] 输入后调用 dispatch 流程创建 assignment。
- [ ] tail `events.jsonl` 并实时刷新 seat 状态。
- [ ] 当 selected seat 状态变化时自动刷新 DeskPanel。
- [ ] 处理终端宽度不足时的降级布局。

## 交付物

- `src/tui/App.tsx`
- `src/tui/BlackboardHeader.tsx`
- `src/tui/SeatCard.tsx`
- `src/tui/DeskPanel.tsx`
- `dev:tui` script

## 验收标准

- [ ] `tsx src/tui/App.tsx` 可启动 TUI。
- [ ] TUI 同屏显示至少两个座位。
- [ ] 左右方向键可切换选中座位。
- [ ] DeskPanel 显示选中座位详情。
- [ ] 输入 `@codex#1 task` 可创建 assignment。
- [ ] seat 状态可从 `queued` 更新到 `running` 再到 `done/failed`。
- [ ] transcript tail 能实时刷新。
- [ ] 失败座位能显示错误信息。

## 不做

- 不做 Web UI。
- 不显示 agent/skill 标签。
- 不显示 hooks。
- 不显示完整 blackboard facts/claims/decisions。

