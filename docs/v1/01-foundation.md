# 01 - 项目脚手架与核心类型

## 目标

建立 V1 最小 TypeScript 项目基础，定义后续模块共享的核心领域类型。此阶段不实现业务流程，只保证项目可安装、可类型检查、可运行最小入口。

## 前置条件

- 已确认使用 TypeScript + Node.js。
- V1 直接通过 `tsx src/...` 运行，不引入完整 CLI 框架。
- 包管理器优先使用 `pnpm`。

## 任务清单

- [ ] 创建 `package.json`，加入基础 scripts：
  - `dev:probe`
  - `dev:corridor`
  - `dev:tui`
  - `typecheck`
- [ ] 添加运行依赖：
  - `execa`
  - `ink`
  - `react`
- [ ] 添加开发依赖：
  - `tsx`
  - `typescript`
  - `@types/node`
  - `@types/react`
- [ ] 创建 `tsconfig.json`，启用严格类型检查。
- [ ] 创建 `src/types.ts`。
- [ ] 定义 `RunnerType`、`RunnerInstance`、`RunnerProbe`。
- [ ] 定义 `SeatState`、`SeatView`、`DeskView`、`ClassroomView`。
- [ ] 定义 `Assignment`、`ContextPack`、`SourceSeatContext`。
- [ ] 定义 V1 事件子集 `AgentRoomEvent`。
- [ ] 定义 `ClassroomCommand` 的 V1 子集：
  - `select_seat`
  - `dispatch`
  - `stop_seat`
- [ ] 创建空入口文件：
  - `src/probe.ts`
  - `src/corridor.ts`
  - `src/contextpack.ts`
  - `src/dispatch-parser.ts`
  - `src/storage.ts`

## 交付物

- `package.json`
- `tsconfig.json`
- `src/types.ts`
- V1 入口文件骨架

## 验收标准

- [ ] `pnpm install` 成功。
- [ ] `pnpm typecheck` 成功。
- [ ] `tsx src/probe.ts` 可运行并输出占位信息。
- [ ] `tsx src/corridor.ts "test"` 可运行并输出占位信息。

## 不做

- 不添加 commander、clipanion 等 CLI 框架。
- 不添加 registry、hooks、flow、memory 类型的完整实现。
- 不引入数据库。

