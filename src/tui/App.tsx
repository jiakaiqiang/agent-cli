import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput, useStdin } from "ink";
import { pathToFileURL } from "node:url";
import { runSeatAssignment } from "../assignment.js";
import { adapterFor } from "../adapters/index.js";
import { parseDispatch, runnerTypeFromSeatId, seatIdToDisplayName } from "../dispatch-parser.js";
import { recoverSession } from "../recovery.js";
import {
  appendEvent,
  appendTranscript,
  createSeat,
  createSession,
  listSessionIds,
  listSeatIds,
  readRoomSettings,
  readSeatState,
  readTranscriptTail,
  writeRoomSettings,
  writeSeatState,
} from "../storage.js";
import type { AgentControlMode, AgentRoomEvent, RunnerType, SeatStateFile, SeatView } from "../types.js";
import { BlackboardHeader } from "./BlackboardHeader.js";
import { DeskPanel } from "./DeskPanel.js";
import { SeatCard } from "./SeatCard.js";
import { runnerTheme, tuiTheme } from "./theme.js";

const runnerChoices: RunnerType[] = ["codex", "claude", "gemini"];
const defaultControlMode: AgentControlMode = "accept";
const deskPanelHeight = 20;
const deskVisibleLineCount = deskPanelHeight - 4;
const deskScrollPageSize = 6;
type AppMode = "loading" | "tool-select" | "room" | "detail";

export function AgentRoomApp({ interactive = true }: { interactive?: boolean }): React.ReactElement {
  const { exit } = useApp();
  const { stdin, isRawModeSupported } = useStdin();
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [seats, setSeats] = useState<SeatView[]>([]);
  const [selected, setSelected] = useState(0);
  const [selectedRunner, setSelectedRunner] = useState(0);
  const [input, setInput] = useState("");
  const [deskLines, setDeskLines] = useState<string[]>([]);
  const [deskScroll, setDeskScroll] = useState(0);
  const [mode, setMode] = useState<AppMode>("loading");
  const dispatchingRef = useRef(false);
  const sessionIdRef = useRef<string | undefined>();
  const sessionInitRef = useRef<Promise<string> | undefined>();

  function syncSessionId(nextSessionId: string): void {
    sessionIdRef.current = nextSessionId;
    setSessionId(nextSessionId);
  }

  async function ensureSessionId(projectRoot: string): Promise<string> {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!sessionInitRef.current) {
      sessionInitRef.current = createSession({ title: "TUI classroom", projectPath: projectRoot }, projectRoot).then((session) => {
        sessionIdRef.current = session.id;
        return session.id;
      });
    }
    return sessionInitRef.current;
  }

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      const projectRoot = process.cwd();
      const nextSessionId = await ensureSessionId(projectRoot);
      if (active) {
        syncSessionId(nextSessionId);
        setSeats([]);
        setSelected(0);
        setMode("tool-select");
      }
    };
    void initialize();
    return () => {
      active = false;
    };
  }, []);

  const selectedSeat = seats[selected];

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    const refreshVisibleSeats = async () => {
      const projectRoot = process.cwd();
      const currentSeats = seats;
      if (currentSeats.length === 0) return;
      const refreshedSeats = await Promise.all(
        currentSeats.map(async (seat) => {
          const state = await readSeatState(sessionId, seat.id, projectRoot);
          return state ? seatStateToView(seat.id, state) : seat;
        }),
      );
      if (!active) return;
      const sorted = refreshedSeats.sort(compareSeats);
      if (!seatsChanged(currentSeats, sorted)) return;
      setSeats(sorted);
      setSelected((value) => Math.min(value, Math.max(sorted.length - 1, 0)));
    };
    const timer = setInterval(() => {
      refreshVisibleSeats().catch(() => undefined);
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [seats, sessionId]);

  useEffect(() => {
    setDeskScroll(0);
  }, [mode, selectedSeat?.id]);

  useEffect(() => {
    setDeskScroll((value) => clampDeskScroll(value, deskLines.length));
  }, [deskLines.length]);

  useEffect(() => {
    restoreInputMode();
  });

  useEffect(() => {
    const loadDesk = async () => {
      if (mode === "loading") {
        setDeskLines(["Starting a new AgentRoom session..."]);
        return;
      }
      if (mode === "tool-select") {
        const runner = runnerChoices[selectedRunner];
        const meta = runnerTheme[runner];
        setDeskLines([
          "#meta Tool palette",
          `Selected: ${meta.label} (${meta.command})`,
          `Next seat: ${nextSeatId(runner, seats)}`,
          `Best for: ${meta.bestFor}`,
          "",
          "Use Left/Right, Up/Down, or 1/2/3 to choose a runner.",
          "Press Enter to create the agent instance.",
          ...(seats.length > 0 ? ["Press Esc, Alt+S, b, or Backspace to return to the classroom."] : ["Press Esc to exit AgentRoom."]),
        ]);
        return;
      }
      if (!sessionId || !selectedSeat) {
        setDeskLines([
          "Agents: 0",
          "Press a or Alt+S to add an agent.",
          "Type /restore to pull the previous agent list into this new session.",
          "Type /help for classroom commands.",
          "Press Esc to exit AgentRoom.",
        ]);
        return;
      }
      if (mode === "room") {
        setDeskLines([
          `Agents: ${seats.length}`,
          `Selected: ${selectedSeat.name}`,
          `State: ${selectedSeat.state}`,
          `Mode: ${formatControlMode(selectedSeat.controlMode)}`,
          `Time: ${formatDuration(selectedSeat.runtimeMs)}`,
          `Now: ${selectedSeat.currentAction ?? selectedSeat.stateText}`,
          `Workspace: ${selectedSeat.workspacePath ?? process.cwd()}`,
          "Press Enter to open the selected agent.",
          "Press Alt+S or a to add another agent.",
          "Press d to delete the selected agent from this classroom.",
          "Type /restore to pull the previous agent list.",
          "Press Esc to exit AgentRoom from this classroom level.",
        ]);
        return;
      }
      if (dispatchingRef.current) return;
      setDeskLines(await buildSeatDetailLines(sessionId, selectedSeat.id, selectedSeat, process.cwd()));
    };
    loadDesk().catch(() => undefined);
  }, [mode, seats.length, sessionId, selectedRunner, selectedSeat?.id]);

  useInput(
    (inputChar, key) => {
      if (key.ctrl && inputChar === "c") {
        exit();
        return;
      }
      if (mode === "loading") return;
      if (key.meta && inputChar?.toLowerCase() === "s") {
        setInput("");
        setMode((current) => (current === "tool-select" && seats.length > 0 ? "room" : "tool-select"));
        return;
      }
      if (key.escape) {
        if (mode === "detail") {
          setInput("");
          setMode("room");
          return;
        }
        if (mode === "tool-select" && seats.length > 0) {
          setInput("");
          setMode("room");
          return;
        }
        exit();
        return;
      }
      if (mode === "tool-select") {
        if ((key.backspace || key.delete || inputChar?.toLowerCase() === "b") && seats.length > 0) {
          setMode("room");
          return;
        }
        if (key.leftArrow || key.upArrow) {
          setSelectedRunner((value) => Math.max(0, value - 1));
          return;
        }
        if (key.rightArrow || key.downArrow) {
          setSelectedRunner((value) => Math.min(runnerChoices.length - 1, value + 1));
          return;
        }
        const numericChoice = Number(inputChar);
        if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= runnerChoices.length) {
          setSelectedRunner(numericChoice - 1);
          return;
        }
        if (key.return) {
          void createAgentSeat(runnerChoices[selectedRunner]);
          return;
        }
        return;
      }
      if (mode === "room" && inputChar?.toLowerCase() === "a") {
        setInput("");
        setMode("tool-select");
        return;
      }
      if (mode === "detail") {
        if (key.upArrow || key.pageUp || key.downArrow || key.pageDown) {
          const delta = key.pageUp ? -deskScrollPageSize : key.pageDown ? deskScrollPageSize : key.upArrow ? -1 : 1;
          setDeskScroll((value) => clampDeskScroll(value + delta, deskLines.length));
          return;
        }
      }
      if (key.leftArrow) {
        setSelected((value) => Math.max(0, value - 1));
        return;
      }
      if (key.rightArrow) {
        setSelected((value) => Math.min(seats.length - 1, value + 1));
        return;
      }
      if (key.return) {
        if (input.trim().startsWith("/") && mode === "room") {
          void handleClassroomCommand(input.trim());
          setInput("");
          return;
        }
        if (!input.trim() && mode === "room" && selectedSeat) {
          setMode("detail");
          return;
        }
        if (!input.trim() && mode === "detail") return;
        if (mode === "detail" && selectedSeat && input.trim().startsWith("/")) {
          void handleAgentCommand(selectedSeat, input.trim());
          setInput("");
          return;
        }
        try {
          const parsed =
            mode === "detail" && selectedSeat && !hasSeatReference(input)
              ? { targetSeatId: selectedSeat.id, sourceSeatIds: [], instruction: input.trim() }
              : parseDispatch(input);
          focusSeatDetail(parsed.targetSeatId);
          void dispatchFromInput(parsed);
        } catch (error) {
          setDeskLines([error instanceof Error ? error.message : String(error)]);
        }
        setInput("");
        return;
      }
      if (key.backspace || key.delete) {
        setInput((value) => value.slice(0, -1));
        return;
      }
      if ((mode === "room" || mode === "detail") && inputChar === "s" && !input && selectedSeat) {
        void stopSelectedSeat(selectedSeat);
        return;
      }
      if (mode === "detail" && key.ctrl && inputChar?.toLowerCase() === "x" && selectedSeat) {
        void stopSelectedSeat(selectedSeat);
        return;
      }
      if (mode === "room" && inputChar?.toLowerCase() === "d" && !input && selectedSeat) {
        void deleteAgentSeat(selectedSeat);
        return;
      }
      if (inputChar) setInput((value) => `${value}${inputChar}`);
    },
    { isActive: interactive },
  );

  async function createAgentSeat(runner: RunnerType): Promise<void> {
    const projectRoot = process.cwd();
    try {
      const nextSessionId = await ensureSessionId(projectRoot);
      const seatId = nextSeatId(runner, seats);
      const ts = new Date().toISOString();
      const state: SeatStateFile = {
        seatId,
        runnerType: runner,
        state: "idle",
        currentAction: "idle",
        workspacePath: projectRoot,
        controlMode: defaultControlMode,
        updatedAt: ts,
      };
      await createSeat(nextSessionId, state, projectRoot);
      await appendEvent(nextSessionId, { type: "seat.state_changed", seatId, state: "idle", ts }, projectRoot);
      const nextSeat = seatStateToView(seatId, state);
      const nextSeats = [...seats, nextSeat].sort(compareSeats);
      const nextSelected = nextSeats.findIndex((seat) => seat.id === seatId);
      await persistRoomSettings(nextSeats, projectRoot);
      syncSessionId(nextSessionId);
      setSeats(nextSeats);
      setSelected(nextSelected >= 0 ? nextSelected : 0);
      setInput("");
      setDeskLines([
        `Created ${seatId}.`,
        "Press Enter to create another agent with the selected tool.",
        "Press Esc, Alt+S, b, or Backspace to return to the classroom.",
      ]);
    } catch (error) {
      setDeskLines([`Create agent failed: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  async function dispatchFromInput(parsed: { targetSeatId: string; sourceSeatIds: string[]; instruction: string }): Promise<void> {
    const projectRoot = process.cwd();
    const targetSeat = seats.find((seat) => seat.id === parsed.targetSeatId);
    const nextSessionId = await ensureSessionId(projectRoot);
    syncSessionId(nextSessionId);
    focusSeatDetail(parsed.targetSeatId);
    dispatchingRef.current = true;
    try {
      await recordUserMessage(nextSessionId, parsed.targetSeatId, parsed.instruction, projectRoot);
      await refreshSeatDetail(nextSessionId, parsed.targetSeatId, targetSeat, projectRoot);
      await runSeatAssignment({
        projectRoot,
        sessionId: nextSessionId,
        runner: runnerTypeFromSeatId(parsed.targetSeatId),
        seatId: parsed.targetSeatId,
        instruction: parsed.instruction,
        sourceSeatIds: parsed.sourceSeatIds,
        controlMode: seats.find((seat) => seat.id === parsed.targetSeatId)?.controlMode ?? defaultControlMode,
        onEvent: (event) => {
          if (event.seatId !== parsed.targetSeatId) return;
          return refreshSeatDetail(nextSessionId, parsed.targetSeatId, targetSeat, projectRoot);
        },
      });
      setDeskLines([
        ...(await buildSeatDetailLines(nextSessionId, parsed.targetSeatId, targetSeat, projectRoot)),
        `#system Dispatch completed: ${parsed.targetSeatId}`,
      ]);
    } catch (error) {
      setDeskLines([
        ...(await buildSeatDetailLines(nextSessionId, parsed.targetSeatId, targetSeat, projectRoot)),
        `#error Dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    } finally {
      dispatchingRef.current = false;
      focusSeatDetail(parsed.targetSeatId);
      restoreInputMode();
    }
  }

  function restoreInputMode(): void {
    if (!interactive || !isRawModeSupported) return;
    try {
      stdin.setEncoding("utf8");
      stdin.resume();
      stdin.setRawMode(true);
    } catch {
      // Some hosted terminals report TTY support but reject raw mode changes.
    }
  }

  function focusSeatDetail(seatId: string): void {
    const targetIndex = seats.findIndex((seat) => seat.id === seatId);
    if (targetIndex < 0) return;
    setSelected(targetIndex);
    setMode("detail");
  }

  async function refreshSeatDetail(
    nextSessionId: string,
    targetSeatId: string,
    targetSeat: SeatView | undefined,
    projectRoot: string,
  ): Promise<void> {
    setDeskLines(await buildSeatDetailLines(nextSessionId, targetSeatId, targetSeat, projectRoot));
  }

  async function handleClassroomCommand(commandInput: string): Promise<void> {
    const [command, arg] = commandInput.slice(1).trim().split(/\s+/, 2);
    if (!command || command === "help") {
      setDeskLines(classroomCommandHelp());
      return;
    }
    if (command === "restore") {
      await restoreAgentList(arg);
      return;
    }
    if (command === "delete" || command === "remove") {
      const seat = arg ? seats.find((candidate) => candidate.id === normalizeSeatId(arg)) : selectedSeat;
      if (!seat) {
        setDeskLines([arg ? `Agent not found: ${arg}` : "No selected agent to delete."]);
        return;
      }
      await deleteAgentSeat(seat);
      return;
    }
    setDeskLines([`Unknown classroom command: /${command}`, "Type /help to see available classroom commands."]);
  }

  async function restoreAgentList(source?: string): Promise<void> {
    if (!sessionId) return;
    const projectRoot = process.cwd();
    try {
      const normalizedSource = source?.trim().toLowerCase();
      if (!normalizedSource || normalizedSource === "settings" || normalizedSource === "saved") {
        const settings = await readRoomSettings(projectRoot);
        if (settings?.seats.length) {
          const restoredSeats = await ensureConfiguredSeats(sessionId, settings.seats, seats, projectRoot);
          setSeats(restoredSeats);
          setSelected((value) => Math.min(value, Math.max(restoredSeats.length - 1, 0)));
          setDeskLines([`Restored ${settings.seats.length} saved agent(s) into this new session.`]);
          return;
        }
      }

      const previousSessionId = await findPreviousSessionId(sessionId, projectRoot);
      if (!previousSessionId) {
        setDeskLines(["No previous agent list was found."]);
        return;
      }
      await recoverSession(previousSessionId, projectRoot);
      const seatIds = await listSeatIds(previousSessionId, projectRoot);
      const configuredSeats = await Promise.all(
        seatIds.map(async (seatId) => {
          const state = await readSeatState(previousSessionId, seatId, projectRoot);
          return {
            seatId,
            runnerType: state?.runnerType ?? runnerTypeFromSeatId(seatId),
            controlMode: state?.controlMode ?? defaultControlMode,
          };
        }),
      );
      if (configuredSeats.length === 0) {
        setDeskLines([`Previous session ${previousSessionId} has no agents to restore.`]);
        return;
      }
      const restoredSeats = await ensureConfiguredSeats(sessionId, configuredSeats, seats, projectRoot);
      await persistRoomSettings(restoredSeats, projectRoot);
      setSeats(restoredSeats);
      setSelected((value) => Math.min(value, Math.max(restoredSeats.length - 1, 0)));
      setDeskLines([`Restored ${configuredSeats.length} agent(s) from ${previousSessionId} into this new session.`]);
    } catch (error) {
      setDeskLines([`Restore failed: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  async function recordUserMessage(sessionId: string, seatId: string, instruction: string, projectRoot: string): Promise<void> {
    const ts = new Date().toISOString();
    await appendTranscript(sessionId, seatId, `User: ${instruction}\n`, projectRoot);
    await appendEvent(sessionId, { type: "activity.appended", seatId, text: `User: ${instruction}`, ts }, projectRoot);
  }

  async function handleAgentCommand(seat: SeatView, commandInput: string): Promise<void> {
    const [command, arg] = commandInput.slice(1).trim().split(/\s+/, 2);
    if (!command || command === "help") {
      setDeskLines(agentCommandHelp(seat));
      return;
    }
    if (command === "mode") {
      if (!arg) {
        setDeskLines([
          `${seat.name} mode: ${formatControlMode(seat.controlMode)}`,
          "Use /mode plan, /mode accept, or /mode full.",
        ]);
        return;
      }
      const nextMode = parseControlMode(arg);
      if (!nextMode) {
        setDeskLines([`Unknown mode: ${arg}`, "Use one of: plan, accept, full."]);
        return;
      }
      await setSeatControlMode(seat, nextMode);
      return;
    }
    if (command === "delete" || command === "remove") {
      await deleteAgentSeat(seat);
      setMode("room");
      return;
    }
    if (command === "stop") {
      await stopSelectedSeat(seat);
      return;
    }
    const shortcutMode = parseControlMode(command);
    if (shortcutMode) {
      await setSeatControlMode(seat, shortcutMode);
      return;
    }
    setDeskLines([`Unknown command: /${command}`, "Type /help to see available agent commands."]);
  }

  async function setSeatControlMode(seat: SeatView, controlMode: AgentControlMode): Promise<void> {
    if (!sessionId) return;
    const projectRoot = process.cwd();
    const existing = await readSeatState(sessionId, seat.id, projectRoot);
    const ts = new Date().toISOString();
    const nextState: SeatStateFile = {
      seatId: seat.id,
      runnerType: existing?.runnerType ?? seat.runnerType,
      state: existing?.state ?? seat.state,
      currentTask: existing?.currentTask ?? seat.currentTask,
      currentAction: existing?.currentAction ?? seat.currentAction,
      workspacePath: existing?.workspacePath ?? seat.workspacePath ?? projectRoot,
      controlMode,
      processId: existing?.processId,
      startedAt: existing?.startedAt ?? seat.startedAt,
      finishedAt: existing?.finishedAt ?? seat.finishedAt,
      error: existing?.error,
      updatedAt: ts,
    };
    await writeSeatState(sessionId, nextState, projectRoot);
    const nextSeats = seats.map((current) => (current.id === seat.id ? { ...current, controlMode } : current));
    await persistRoomSettings(nextSeats, projectRoot);
    setSeats(nextSeats);
    setDeskLines([
      `${seat.name} mode switched to ${formatControlMode(controlMode)}.`,
      controlModeDescription(controlMode),
    ]);
  }

  async function stopSelectedSeat(seat: SeatView): Promise<void> {
    if (!sessionId) return;
    const projectRoot = process.cwd();
    await adapterFor(seat.runnerType).stop(seat.id);
    const ts = new Date().toISOString();
    await writeSeatState(sessionId, {
      seatId: seat.id,
      runnerType: seat.runnerType,
      state: "stopped",
      currentTask: seat.currentTask,
      currentAction: "stopped",
      workspacePath: seat.workspacePath,
      controlMode: seat.controlMode,
      updatedAt: ts,
    }, projectRoot);
    await appendEvent(sessionId, { type: "seat.state_changed", seatId: seat.id, state: "stopped", ts }, projectRoot);
    setDeskLines([`Stopped ${seat.id}`]);
  }

  async function deleteAgentSeat(seat: SeatView): Promise<void> {
    const projectRoot = process.cwd();
    if (seat.state === "running" || seat.state === "queued") {
      await adapterFor(seat.runnerType).stop(seat.id);
    }
    const nextSeats = seats.filter((current) => current.id !== seat.id).sort(compareSeats);
    await persistRoomSettings(nextSeats, projectRoot);
    setSeats(nextSeats);
    setSelected((value) => Math.min(value, Math.max(nextSeats.length - 1, 0)));
    setInput("");
    setDeskLines([
      `Deleted ${seat.id} from this classroom.`,
      "Historical session files were kept under .agentroom/sessions.",
    ]);
  }

  const header = useMemo(() => (sessionId ? `session ${sessionId}` : "no active session"), [sessionId]);
  const selectedRunnerType = runnerChoices[selectedRunner];
  const selectedRunnerMeta = runnerTheme[selectedRunnerType];
  const dispatchExample = selectedSeat ? `@${selectedSeat.runnerType}#${selectedSeat.id.split("-")[1] ?? "1"}` : "@codex#1";
  const isLoading = mode === "loading";
  const isToolSelect = mode === "tool-select";
  const isDetail = mode === "detail";
  const activeAccent = isToolSelect ? selectedRunnerMeta.color : selectedSeat ? runnerTheme[selectedSeat.runnerType].color : tuiTheme.borderActive;
  const headerMeta = [
    { label: "view", value: formatAppMode(mode) },
    { label: "agents", value: String(seats.length) },
    { label: "cwd", value: compactPath(process.cwd(), 44) },
  ];

  return (
    <Box flexDirection="column" rowGap={1}>
      <BlackboardHeader title={header} subtitle="Local multi-agent command room" meta={headerMeta} />
      <Box flexDirection="column" rowGap={1}>
        {isLoading ? (
          <Box borderStyle="single" borderColor={tuiTheme.borderActive} paddingX={1}>
            <Text color={tuiTheme.warning}>Starting a new AgentRoom session...</Text>
          </Box>
        ) : isToolSelect
          ? (
              <ToolSelection
                choices={runnerChoices}
                selectedRunner={selectedRunner}
                nextSeatId={nextSeatId(selectedRunnerType, seats)}
                existingCount={seats.length}
              />
            )
          : (
              <Box columnGap={2} rowGap={1} flexWrap="wrap">
                {seats.length > 0 ? (
                  seats.map((seat, index) => <SeatCard key={seat.id} seat={seat} selected={index === selected} />)
                ) : (
                  <Box borderStyle="single" borderColor={tuiTheme.border} paddingX={1}>
                    <Text color={tuiTheme.dim}>No agents yet. Press a or Alt+S to add one.</Text>
                  </Box>
                )}
              </Box>
            )}
      </Box>
      <DeskPanel
        title={isLoading ? "Loading" : isToolSelect ? "Tool selection" : isDetail ? selectedSeat?.name ?? "Agent detail" : "Classroom"}
        lines={deskLines}
        height={deskPanelHeight}
        scrollOffset={deskScroll}
        accentColor={activeAccent}
      />
      <PromptLine
        text={
          isLoading
            ? "Starting a fresh classroom session..."
            : isToolSelect
              ? `${selectedRunnerMeta.label} selected - Enter creates ${nextSeatId(selectedRunnerType, seats)}${seats.length > 0 ? ", Esc/Alt+S returns" : ", Esc exits"}`
              : isDetail
                ? input || `(type a message or /help for ${selectedSeat?.name ?? dispatchExample}, Ctrl+X stops, Up/Down/PageUp/PageDown scroll, Esc returns)`
                : input || `(a adds, /restore pulls history, /help commands${selectedSeat ? ", Enter opens, d deletes, arrows switch" : ""}, Esc exits)`
        }
        muted={!input}
        accentColor={activeAccent}
      />
    </Box>
  );
}

function ToolSelection({
  choices,
  selectedRunner,
  nextSeatId,
  existingCount,
}: {
  choices: RunnerType[];
  selectedRunner: number;
  nextSeatId: string;
  existingCount: number;
}): React.ReactElement {
  const selected = choices[selectedRunner];
  const selectedMeta = runnerTheme[selected];

  return (
    <Box flexDirection="column" rowGap={1}>
      <Box justifyContent="space-between">
        <Text bold color={tuiTheme.text}>Create agent</Text>
        <Text color={tuiTheme.dim}>Left/Right or 1/2/3, Enter to launch</Text>
      </Box>
      <Box columnGap={2} rowGap={1} flexWrap="wrap">
        {choices.map((runner, index) => (
          <ToolSelectCard key={runner} runner={runner} index={index} selected={index === selectedRunner} />
        ))}
      </Box>
      <Box borderStyle="single" borderColor={selectedMeta.color} paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Text>
            <Text color={selectedMeta.color} bold>[{selectedMeta.short}] </Text>
            <Text color={tuiTheme.text} bold>{selectedMeta.label}</Text>
          </Text>
          <Text color={tuiTheme.dim}>next {nextSeatId}</Text>
        </Box>
        <Text color={tuiTheme.dim}>{selectedMeta.description}</Text>
        <Text color={tuiTheme.text}>Best for: {selectedMeta.bestFor}</Text>
        <Text color={tuiTheme.dim}>
          Command: {selectedMeta.command} / Existing agents: {existingCount}
        </Text>
      </Box>
    </Box>
  );
}

function ToolSelectCard({ runner, index, selected }: { runner: RunnerType; index: number; selected: boolean }): React.ReactElement {
  const meta = runnerTheme[runner];

  return (
    <Box
      borderStyle={selected ? "double" : "single"}
      borderColor={selected ? meta.color : tuiTheme.border}
      paddingX={1}
      flexDirection="column"
      width={24}
      minHeight={5}
      flexShrink={0}
    >
      <Box justifyContent="space-between">
        <Text>
          <Text color={selected ? meta.color : tuiTheme.dim}>{selected ? "> " : "  "}{index + 1}. </Text>
          <Text bold={selected} color={selected ? tuiTheme.text : tuiTheme.dim}>{meta.label}</Text>
        </Text>
        <Text color={selected ? meta.color : tuiTheme.dim}>{meta.short}</Text>
      </Box>
      <Text color={selected ? tuiTheme.text : tuiTheme.dim} wrap="truncate-end">{meta.description}</Text>
      <Text color={selected ? meta.color : tuiTheme.dim}>{selected ? "Enter creates agent" : "Select runner"}</Text>
    </Box>
  );
}

function PromptLine({ text, muted, accentColor }: { text: string; muted: boolean; accentColor: string }): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor={muted ? tuiTheme.border : accentColor} paddingX={1}>
      <Text color={accentColor} bold>{muted ? "hint " : "cmd  "}</Text>
      <Text color={muted ? tuiTheme.dim : tuiTheme.text}>{text}</Text>
    </Box>
  );
}

function formatAppMode(mode: AppMode): string {
  switch (mode) {
    case "loading":
      return "loading";
    case "tool-select":
      return "tool palette";
    case "room":
      return "classroom";
    case "detail":
      return "agent detail";
  }
}

function compactPath(value: string, maxLength: number): string {
  const normalized = value.replace(/\//g, "\\").trim();
  if (normalized.length <= maxLength) return normalized;
  const parts = normalized.split("\\").filter(Boolean);
  const tail = parts.slice(-2).join("\\");
  return tail.length <= maxLength - 4 ? `...\\${tail}` : `...${normalized.slice(-(maxLength - 3))}`;
}

function seatStateToView(seatId: string, state: SeatStateFile | undefined): SeatView {
  return {
    id: seatId,
    runnerType: state?.runnerType ?? runnerTypeFromSeatId(seatId),
    name: seatIdToDisplayName(seatId),
    state: state?.state ?? "idle",
    stateText: state?.error ?? state?.state ?? "idle",
    currentTask: state?.currentTask,
    currentAction: state?.currentAction,
    workspacePath: state?.workspacePath ?? process.cwd(),
    controlMode: state?.controlMode ?? defaultControlMode,
    startedAt: state?.startedAt,
    finishedAt: state?.finishedAt,
    changedFiles: 0,
    runtimeMs: runtimeMs(state),
    needsUser: false,
  };
}

function nextSeatId(runner: RunnerType, seats: SeatView[]): string {
  const indexes = seats
    .filter((seat) => seat.runnerType === runner)
    .map((seat) => Number(seat.id.split("-")[1]))
    .filter((value) => Number.isInteger(value) && value > 0);
  const nextIndex = indexes.length ? Math.max(...indexes) + 1 : 1;
  return `${runner}-${nextIndex}`;
}

async function ensureConfiguredSeats(
  sessionId: string,
  configuredSeats: Array<{ seatId: string; runnerType: RunnerType; controlMode?: AgentControlMode }>,
  currentSeats: SeatView[],
  projectRoot: string,
): Promise<SeatView[]> {
  const nextSeats = [...currentSeats];
  const existingSeatIds = new Set(nextSeats.map((seat) => seat.id));

  for (const configuredSeat of configuredSeats) {
    if (existingSeatIds.has(configuredSeat.seatId)) {
      if (configuredSeat.controlMode) {
        const index = nextSeats.findIndex((seat) => seat.id === configuredSeat.seatId);
        if (index >= 0) nextSeats[index] = { ...nextSeats[index], controlMode: configuredSeat.controlMode };
      }
      continue;
    }
    const ts = new Date().toISOString();
    const state: SeatStateFile = {
      seatId: configuredSeat.seatId,
      runnerType: configuredSeat.runnerType,
      state: "idle",
      currentAction: "idle",
      workspacePath: projectRoot,
      controlMode: configuredSeat.controlMode ?? defaultControlMode,
      updatedAt: ts,
    };
    await createSeat(sessionId, state, projectRoot);
    await appendEvent(sessionId, { type: "seat.state_changed", seatId: configuredSeat.seatId, state: "idle", ts }, projectRoot);
    nextSeats.push(seatStateToView(configuredSeat.seatId, state));
    existingSeatIds.add(configuredSeat.seatId);
  }

  return nextSeats.sort(compareSeats);
}

async function persistRoomSettings(seats: SeatView[], projectRoot: string): Promise<void> {
  await writeRoomSettings(
    {
      seats: [...seats].sort(compareSeats).map((seat) => ({
        seatId: seat.id,
        runnerType: seat.runnerType,
        controlMode: seat.controlMode,
      })),
      updatedAt: new Date().toISOString(),
    },
    projectRoot,
  );
}

function compareSeats(left: SeatView, right: SeatView): number {
  const runnerOrder = runnerChoices.indexOf(left.runnerType) - runnerChoices.indexOf(right.runnerType);
  if (runnerOrder !== 0) return runnerOrder;
  return seatIndex(left.id) - seatIndex(right.id);
}

function seatIndex(seatId: string): number {
  const value = Number(seatId.split("-")[1]);
  return Number.isInteger(value) ? value : Number.MAX_SAFE_INTEGER;
}

function seatsChanged(prev: SeatView[], next: SeatView[]): boolean {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (
      a.id !== b.id ||
      a.state !== b.state ||
      a.currentTask !== b.currentTask ||
      a.currentAction !== b.currentAction ||
      a.controlMode !== b.controlMode ||
      a.finishedAt !== b.finishedAt
    ) {
      return true;
    }
  }
  return false;
}

async function buildSeatDetailLines(
  sessionId: string,
  seatId: string,
  fallbackSeat: SeatView | undefined,
  projectRoot: string,
): Promise<string[]> {
  const [state, tail] = await Promise.all([
    readSeatState(sessionId, seatId, projectRoot),
    readTranscriptTail(sessionId, seatId, 100, projectRoot),
  ]);
  const seat = state ? seatStateToView(seatId, state) : fallbackSeat;
  const lines: string[] = [
    `#meta Seat: ${seat?.name ?? seatIdToDisplayName(seatId)} (${seatId})`,
    `#meta Workspace: ${seat?.workspacePath ?? process.cwd()}`,
    `#meta Mode: ${formatControlMode(seat?.controlMode ?? defaultControlMode)}`,
    `#meta Task: ${seat?.currentTask ?? "Idle"}`,
    `#meta Commands: /help, /mode [plan|accept|full]`,
    "",
  ];

  if (tail.length > 0) {
    lines.push(...tail);
  } else {
    lines.push("(no transcript yet)");
  }

  return lines;
}

async function findPreviousSessionId(currentSessionId: string, projectRoot: string): Promise<string | undefined> {
  const ids = await listSessionIds(projectRoot);
  return ids.filter((id) => id !== currentSessionId).at(-1);
}

function clampDeskScroll(value: number, lineCount: number): number {
  return Math.min(Math.max(0, value), Math.max(0, lineCount - deskVisibleLineCount));
}

function formatSeatEvent(event: AgentRoomEvent): string {
  const ts = formatEventTime(event.ts);
  switch (event.type) {
    case "activity.appended":
      return `${ts} activity: ${event.text}`;
    case "seat.state_changed":
      return `${ts} state: ${event.state}`;
    case "file.changed":
      return `${ts} file ${event.changeType}: ${event.path}`;
    case "assignment.started":
      return `${ts} assignment started: ${event.assignmentId}`;
    case "assignment.completed":
      return `${ts} assignment completed: ${event.assignmentId}`;
    case "assignment.failed":
      return `${ts} assignment failed: ${event.error}`;
  }
}

function formatEventTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString("en-US", { hour12: false });
}

function splitPanelLines(value: string): string[] {
  const lines = value.split(/\r?\n/);
  return lines.length ? lines : ["(empty)"];
}

function agentCommandHelp(seat: SeatView): string[] {
  return [
    `${seat.name} commands:`,
    `/mode - show current permission mode (${formatControlMode(seat.controlMode)})`,
    "/mode plan - planning only; no file writes",
    "/mode accept - normal work with confirmation for risky actions",
    "/mode full - run end-to-end with full control",
    "/stop - stop the running agent (Ctrl+X or clear input and press s)",
    "/delete - remove this agent from the classroom",
    "Shortcuts: /plan, /accept, /full",
  ];
}

function classroomCommandHelp(): string[] {
  return [
    "Classroom commands:",
    "/restore - pull the saved agent list into this new session",
    "/restore session - pull agents from the latest previous session",
    "/delete - remove the selected agent from this classroom",
    "/delete codex-1 - remove a specific agent",
  ];
}

function parseControlMode(value: string | undefined): AgentControlMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "plan" || normalized === "planning") return "plan";
  if (normalized === "accept" || normalized === "receive" || normalized === "normal") return "accept";
  if (normalized === "full" || normalized === "auto" || normalized === "control") return "full";
  return undefined;
}

function formatControlMode(controlMode: AgentControlMode): string {
  switch (controlMode) {
    case "plan":
      return "plan";
    case "accept":
      return "accept";
    case "full":
      return "full control";
  }
}

function controlModeDescription(controlMode: AgentControlMode): string {
  switch (controlMode) {
    case "plan":
      return "Plan mode: the agent should analyze and plan only; Codex runs with read-only sandbox.";
    case "accept":
      return "Accept mode: the agent can work in the workspace and should ask before risky actions.";
    case "full":
      return "Full control mode: Codex runs with approvals and sandbox bypassed for this agent.";
  }
}

function hasSeatReference(input: string): boolean {
  return /@(codex|claude|gemini)#\d+/i.test(input);
}

function normalizeSeatId(value: string): string {
  const normalized = value.trim().replace(/^@/, "").replace("#", "-").toLowerCase();
  return normalized;
}

function runtimeMs(state: SeatStateFile | undefined): number {
  if (!state?.startedAt) return 0;
  const end = state.finishedAt ? Date.parse(state.finishedAt) : Date.now();
  const start = Date.parse(state.startedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  render(<AgentRoomApp />);
}
