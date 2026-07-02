# AgentRoom MVP Plan

## MVP Goal

Build a local TypeScript CLI/TUI prototype that can:

1. Scan local Codex, Claude Code, and Gemini CLIs.
2. Let the user start multiple runner instances as classroom seats.
3. Load agents, skills, hooks, and flows from local files.
4. Render a classroom-style TUI with colored runners/agents/skills/hooks.
5. Accept natural-language `@seat` dispatch commands.
6. Package referenced seat outputs into context for hand-off.
7. Run a black-box CLI process and capture logs/artifacts.
8. Store all session state in local files, no database.

## Non-Goals for MVP

- No Web UI.
- No database.
- No enterprise permissions.
- No cloud execution.
- No plugin marketplace.
- No automatic multi-agent merge.
- No full parser for every Codex/Claude/Gemini internal config format.
- No complex workflow engine. Flow is only a macro over dispatch assignments.

## Milestone 1: Project Skeleton

Deliverables:

- TypeScript project scaffold.
- CLI entrypoint.
- Basic config loader.
- Basic filesystem session store.

Suggested structure:

```text
src/
  cli/
  core/
  tui/
  adapters/
  registry/
  memory/
  hooks/
  storage/
  builtin/
```

Acceptance:

- `agentroom --help` works.
- `agentroom doctor` prints project/global config paths.
- A session directory can be created under `.agentroom/sessions/`.

## Milestone 2: Runner Probing and Startup Selection

Deliverables:

- Probe Codex, Claude, Gemini via version commands.
- Startup selection model supports multiple instances.
- Persist last startup selection.

Acceptance:

- User can create seats like `Codex #1`, `Codex #2`, `Claude #1`.
- Startup defaults to last selection.
- Pressing or invoking setup can reselect seats.

## Milestone 3: Registry Loading

Deliverables:

- Built-in agents/skills/hooks/flows.
- Load global `~/.agentroom`.
- Load project `.agentroom`.
- Adapter framework for runner-local config sources.
- Merge with priority: project > global > runner > builtin.

Acceptance:

- `/agents` can list merged agents with source and color.
- `/skills` can list merged skills with source and color.
- Conflicting items show active source and overridden sources.

## Milestone 4: Classroom State and File Store

Deliverables:

- `ClassroomView`
- `ClassroomCommand`
- `AgentRoomEvent`
- `events.jsonl`
- `classroom.json`
- per-seat `state.json`

Acceptance:

- The core can restore classroom state from files.
- Event appends update current view.
- No database is required.

## Milestone 5: TUI Classroom View

Deliverables:

- Ink TUI layout:
  - blackboard header
  - seat row/grid
  - selected desk panel
- Keyboard navigation.
- Colored runner/agent/skill/hook labels.

Acceptance:

- Left/right moves selected seat.
- Desk panel updates for selected seat.
- Seat color and state color are visible.
- TUI can run without any active assignment.

## Milestone 6: Natural-Language Dispatch

Deliverables:

- Parse commands like:
  - `@codex#1 修复登录超时 bug`
  - `@claude#1 审查 @codex#1 的结果`
- Extract target seat, source seats, instruction.
- Infer agent and skill from registry triggers.
- Allow explicit agent/skill override in text when recognizable.

Acceptance:

- Dispatch creates an `Assignment`.
- Assignment includes selected agent/skill with source/color metadata.
- Referenced seats are added to `ContextPack`.

## Milestone 7: Runner Execution

Deliverables:

- Black-box process runner.
- Codex adapter.
- Claude adapter.
- Gemini adapter.
- Transcript capture.
- Seat state transitions.

Acceptance:

- A simple assignment can launch the selected CLI.
- stdout/stderr are written to transcript and events.
- Seat moves through `queued -> running state -> done/failed`.

## Milestone 8: Artifact and Evidence Collection

Deliverables:

- Collect git diff and diff stat after assignments.
- Store `summary.md` placeholder or parsed output.
- Store `patch.diff`.
- Record file changes.

Acceptance:

- Desk shows changed files.
- `@claude#1 审查 @codex#1` receives Codex summary/diff/artifacts in context.

## Milestone 9: Hook Runtime

Deliverables:

- Shell hook runtime.
- JS hook runtime.
- Python hook runtime with stdin/stdout JSON.
- Approval hook.
- Hook state in TUI.

Acceptance:

- `before_assignment` and `after_assignment` hooks run.
- JS/Python hooks can return blackboard updates and memory candidates.
- Shell hooks cannot directly modify blackboard/memory.
- First run of project JS/Python hooks requires approval.

## Milestone 10: Blackboard and Memory Candidates

Deliverables:

- Blackboard file and view.
- Shared memory file.
- Memory candidate collection.
- User confirmation before writing long-term project/user memory.

Acceptance:

- Assignment summaries can update blackboard.
- Memory candidates are shown for approval.
- Approved project memory is written under `.agentroom/memory/project.md`.

## Milestone 11: Flow Mode

Deliverables:

- Load flow definitions.
- Flow setup screen.
- Role-to-seat assignment.
- Remember last assignment per flow.
- Execute flow as a sequence of dispatch assignments.

Acceptance:

- `/flow bugfix "..."` opens role assignment.
- First run uses recommended roles.
- Next run remembers prior role assignment.
- Flow execution creates normal assignments, not a separate engine path.

## Milestone 12: Polish and Safety

Deliverables:

- Clear error states.
- Runner missing/auth unknown display.
- Worktree policy for write assignments.
- Basic cleanup commands.
- Session export as folder/zip-ready files.

Acceptance:

- Missing runners appear as unavailable.
- Failed assignments are visible and inspectable.
- User can stop a running seat.
- Session folder contains enough data for debugging.

## First Demo Scenario

Start AgentRoom:

```text
agentroom
```

Create seats:

```text
Codex #1
Claude #1
Gemini #1
```

Dispatch:

```text
@codex#1 修复登录超时 bug，尽量最小改动并补测试
@claude#1 审查 @codex#1 的结果，重点看有没有回归风险
@gemini#1 看一下 @codex#1 和 @claude#1 的结果，有没有安全和边界问题
```

Expected demo output:

- TUI shows each seat state.
- Codex transcript and patch are saved.
- Claude receives Codex artifacts.
- Gemini receives Codex + Claude artifacts.
- Blackboard contains session summary, claims, open questions.
- Memory candidates require confirmation.

