# AgentRoom Executable Task List

This file turns the product and architecture design into implementable tasks.

## Phase 0: Decisions

- [ ] Choose package manager: npm, pnpm, or yarn.
- [ ] Choose CLI library: commander or clipanion.
- [ ] Choose TUI library: Ink.
- [ ] Choose process library: Node child_process or execa.
- [ ] Pick binary name: `agentroom`.

Recommended defaults:

- package manager: pnpm
- CLI: commander
- TUI: Ink
- process: execa
- binary: agentroom

## Phase 1: Scaffold

- [ ] Create `package.json`.
- [ ] Add TypeScript config.
- [ ] Add lint/format/test scripts.
- [ ] Add `src/cli/main.ts`.
- [ ] Add `src/core/index.ts`.
- [ ] Add `src/tui/App.tsx`.
- [ ] Wire `agentroom --help`.
- [ ] Wire `agentroom doctor`.

Acceptance command:

```bash
agentroom --help
agentroom doctor
```

## Phase 2: Core Types

- [ ] Define `RunnerType`.
- [ ] Define `RunnerInstance`.
- [ ] Define `SeatState`.
- [ ] Define `SeatView`.
- [ ] Define `Assignment`.
- [ ] Define `ContextPack`.
- [ ] Define `ClassroomView`.
- [ ] Define `ClassroomCommand`.
- [ ] Define `AgentRoomEvent`.
- [ ] Define registry item types.
- [ ] Define hook types.
- [ ] Define blackboard/memory types.

Files:

```text
src/core/types.ts
src/registry/types.ts
src/hooks/types.ts
src/memory/types.ts
```

## Phase 3: File Store

- [ ] Implement path resolver for project `.agentroom`.
- [ ] Implement path resolver for global `~/.agentroom`.
- [ ] Implement session id generator.
- [ ] Create session directory.
- [ ] Write/read `classroom.json`.
- [ ] Write/read `blackboard.json`.
- [ ] Append/read `events.jsonl`.
- [ ] Write/read per-seat `state.json`.

Files:

```text
src/storage/paths.ts
src/storage/session-store.ts
src/storage/jsonl.ts
```

Acceptance:

- `agentroom doctor` prints resolved paths.
- `agentroom session create` creates a valid session folder.

## Phase 4: Runner Probe

- [ ] Implement `RunnerAdapter` interface.
- [ ] Implement Codex probe via `codex --version`.
- [ ] Implement Claude probe via `claude --version`.
- [ ] Implement Gemini probe via `gemini --version`.
- [ ] Handle command missing.
- [ ] Return version/auth unknown.

Files:

```text
src/adapters/types.ts
src/adapters/codex.ts
src/adapters/claude.ts
src/adapters/gemini.ts
src/adapters/probe.ts
```

Acceptance:

```bash
agentroom runners
```

Shows installed/unavailable state for Codex, Claude, Gemini.

## Phase 5: Startup Seat Selection

- [ ] Store previous startup selection.
- [ ] Support multiple instances per runner type.
- [ ] Generate ids like `codex-1`, `claude-2`.
- [ ] Add setup command.
- [ ] Add startup path that defaults to previous selection.

Commands:

```bash
agentroom setup
agentroom
```

Acceptance:

- User can configure two Codex seats and one Claude seat.
- Next startup uses same seats by default.

## Phase 6: Registry Loader

- [ ] Add built-in agents.
- [ ] Add built-in skills.
- [ ] Add built-in hooks.
- [ ] Add built-in flows.
- [ ] Load global registry files.
- [ ] Load project registry files.
- [ ] Add runner registry adapter interface.
- [ ] Add placeholder Codex/Claude/Gemini registry adapters.
- [ ] Merge items by priority.
- [ ] Detect conflicts.
- [ ] Assign colors.

Files:

```text
src/builtin/agents/*.yaml
src/builtin/skills/*.yaml
src/builtin/hooks/*.yaml
src/builtin/flows/*.yaml
src/registry/loader.ts
src/registry/merge.ts
src/registry/match.ts
```

Acceptance:

```bash
agentroom agents
agentroom skills
agentroom hooks
```

Show merged items with source, status, and color.

## Phase 7: Agent and Skill Matching

- [ ] Implement trigger keyword scoring.
- [ ] Infer agent from instruction.
- [ ] Infer skill from instruction.
- [ ] Support explicit agent hints.
- [ ] Support explicit skill hints.
- [ ] Add match explanation for UI.

Acceptance:

```text
@codex#1 修复登录超时 bug
```

Infers:

- agent: implementer
- skill: bugfix

## Phase 8: TUI Classroom

- [ ] Render blackboard header.
- [ ] Render seat cards.
- [ ] Render selected desk.
- [ ] Add left/right selection.
- [ ] Add tabbed desk sections: Activity, Files, Skills, Hooks, Artifacts.
- [ ] Apply colors for runner/agent/skill/hook.
- [ ] Render unavailable runner state.

Files:

```text
src/tui/App.tsx
src/tui/components/SeatCard.tsx
src/tui/components/DeskPanel.tsx
src/tui/components/BlackboardHeader.tsx
```

Acceptance:

- TUI opens with configured seats.
- Left/right changes selected seat.
- Colors are visible.

## Phase 9: Dispatch Parser

- [ ] Parse target seat mention.
- [ ] Parse source seat mentions.
- [ ] Preserve original Chinese instruction.
- [ ] Create assignment from parsed command.
- [ ] Build context pack from source seats.
- [ ] Write assignment to session files.

Examples:

```text
@codex#1 修复登录超时 bug
@claude#1 审查 @codex#1 的结果
@gemini#1 看一下 @codex#1 和 @claude#1 的风险
```

Acceptance:

- Parsed command produces target, sources, instruction, inferred agent/skill.

## Phase 10: Runner Execution

- [ ] Implement generic process execution.
- [ ] Stream stdout/stderr to transcript.
- [ ] Emit activity events.
- [ ] Update seat state.
- [ ] Stop process by seat id.
- [ ] Save exit code and error.
- [ ] Add minimal command template per runner.

Acceptance:

- Dispatch to a configured runner starts a process.
- Transcript appears under `sessions/<id>/seats/<seat>/transcript.log`.

## Phase 11: Artifacts and Evidence

- [ ] Run safe post-assignment collection:
  - `git diff`
  - `git diff --stat`
- [ ] Store patch.
- [ ] Store changed files.
- [ ] Create placeholder summary.
- [ ] Add evidence JSONL writers.
- [ ] Include artifacts in source-seat context packs.

Acceptance:

- After Codex assignment, Claude hand-off receives Codex patch and summary path.

## Phase 12: Hook Runtime

- [ ] Implement hook scheduler by lifecycle.
- [ ] Implement shell hook.
- [ ] Implement JS hook.
- [ ] Implement Python hook with stdin/stdout JSON.
- [ ] Implement approval hook.
- [ ] Require first-run approval for project JS/Python hooks.
- [ ] Apply JS/Python blackboard updates through core only.
- [ ] Collect memory candidates.

Acceptance:

- A JS hook can return a blackboard claim.
- A Python hook can return a memory candidate.
- Shell hook output is logged but does not directly change blackboard.

## Phase 13: Blackboard and Memory

- [ ] Implement blackboard read/write.
- [ ] Implement facts/claims/open questions/decisions.
- [ ] Implement shared memory file.
- [ ] Implement memory candidate queue.
- [ ] Add TUI approval view for memory candidates.
- [ ] Write approved project memory.
- [ ] Write approved user memory.

Acceptance:

- Long-term memory is never written without user approval.

## Phase 14: Flow Mode

- [ ] Load flow definitions.
- [ ] Implement flow setup screen.
- [ ] Recommend role-to-seat assignments.
- [ ] Remember last role assignment per flow.
- [ ] Execute flow as dispatch assignments.

Acceptance:

- `/flow bugfix "..."` opens setup.
- User confirms roles.
- Flow creates normal assignments.

## Phase 15: Workspace Policy

- [ ] Detect assignment intent: write vs read/review/check.
- [ ] Allow shared workspace for read/review/check.
- [ ] Use git worktree for concurrent write assignments.
- [ ] Record worktree path in runner instance.
- [ ] Add cleanup command.

Acceptance:

- Two write assignments do not modify the same working tree by default.

## Phase 16: First End-to-End Demo

- [ ] Configure seats: Codex #1, Claude #1, Gemini #1.
- [ ] Dispatch to Codex.
- [ ] Capture Codex logs and patch.
- [ ] Dispatch Claude with Codex context.
- [ ] Dispatch Gemini with Codex + Claude context.
- [ ] Show final blackboard summary.
- [ ] Show memory candidates.

Demo script:

```text
@codex#1 修复登录超时 bug，尽量最小改动并补测试
@claude#1 审查 @codex#1 的结果，重点看有没有回归风险
@gemini#1 看一下 @codex#1 和 @claude#1 的结果，有没有安全和边界问题
```

## Phase 17: Documentation

- [ ] Write README quickstart.
- [ ] Document config format.
- [ ] Document registry merge priority.
- [ ] Document hook API.
- [ ] Document memory model.
- [ ] Document safety limitations.

