import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput, useStdin, useStdout } from "ink";
import { pathToFileURL } from "node:url";
import { runSeatAssignment } from "../assignment.js";
import { adapterFor } from "../adapters/index.js";
import { contextClearTranscriptLine } from "../context-control.js";
import { parseDispatchWithDefaultTarget, runnerTypeFromSeatId, seatIdToDisplayName } from "../dispatch-parser.js";
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
  readTranscript,
  readTranscriptTail,
  writePatch,
  writeRoomSettings,
  writeSeatState,
  writeSummary,
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
  const { stdout } = useStdout();
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [seats, setSeats] = useState<SeatView[]>([]);
  const [selected, setSelected] = useState(0);
  const [selectedRunner, setSelectedRunner] = useState(0);
  const [input, setInput] = useState("");
  const [inputCursor, setInputCursor] = useState(0);
  const [deskLines, setDeskLines] = useState<string[]>([]);
  const [deskScroll, setDeskScroll] = useState(0);
  const [mode, setMode] = useState<AppMode>("loading");
  const [allowDirty, setAllowDirty] = useState(false);
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
      const savedSettings = await readRoomSettings(projectRoot);
      const session = await createSession({ title: "TUI classroom", projectPath: projectRoot }, projectRoot);
      const nextSessionId = session.id;
      sessionIdRef.current = nextSessionId;
      if (active) {
        syncSessionId(nextSessionId);
        setSeats([]);
        setSelected(0);
        if (savedSettings?.allowDirty) setAllowDirty(true);
        setMode("tool-select");
        setDeskLines([
          `Started fresh session ${nextSessionId}.`,
          `Workspace: ${projectRoot}`,
          `Dirty workspace: ${savedSettings?.allowDirty ? "allowed (/allow-dirty off to disable)" : "blocked (/allow-dirty on to allow)"}`,
          "Press r from tool selection to restore the saved or previous agent list.",
        ]);
      }
    };
    void initialize().catch((error: unknown) => {
      if (!active) return;
      setDeskLines([`Startup failed: ${error instanceof Error ? error.message : String(error)}`]);
      setMode("tool-select");
    });
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
        setDeskLines([
          "Starting a new AgentRoom session...",
          `Workspace: ${process.cwd()}`,
        ]);
        return;
      }
      if (mode === "tool-select") {
        const runner = runnerChoices[selectedRunner];
        const meta = runnerTheme[runner];
        setDeskLines([
          "#meta Tool palette",
          `#meta Workspace: ${process.cwd()}`,
          `Selected: ${meta.label} (${meta.command})`,
          `Next seat: ${nextSeatId(runner, seats)}`,
          `Best for: ${meta.bestFor}`,
          "",
          "Use Left/Right, Up/Down, or 1/2/3 to choose a runner.",
          "Press Enter to create the agent instance.",
          "Press r to restore the saved or previous agent list.",
          ...(seats.length > 0
            ? ["Press b, Backspace, or Alt+S to return to the classroom.", "Press q or Ctrl+C to exit AgentRoom."]
            : ["Press q or Ctrl+C to exit AgentRoom."]),
        ]);
        return;
      }
      if (!sessionId || !selectedSeat) {
        setDeskLines([
          "Agents: 0",
          `Workspace: ${process.cwd()}`,
          "Press Alt+S to add an agent.",
          "Type /restore to pull the previous agent list into this new session.",
          "Type /help for classroom commands.",
          "Press q or Ctrl+C to exit AgentRoom.",
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
          "Press Alt+S to add another agent.",
          "Type /delete to remove the selected agent from this classroom.",
          "Type /restore to pull the previous agent list.",
          "Press Esc to return to tool selection.",
          "Press q or Ctrl+C to exit AgentRoom.",
        ]);
        return;
      }
      if (dispatchingRef.current) return;
      setDeskLines(await buildSeatDetailLines(sessionId, selectedSeat.id, selectedSeat, process.cwd()));
    };
    loadDesk().catch(() => undefined);
  }, [
    mode,
    seats.length,
    sessionId,
    selectedRunner,
    selectedSeat?.id,
    selectedSeat?.state,
    selectedSeat?.currentAction,
    selectedSeat?.needsUser,
    selectedSeat?.runtimeMs,
  ]);

  useInput(
    (inputChar, key) => {
      if (key.ctrl && inputChar === "c") {
        exit();
        return;
      }
      if (mode === "tool-select" && inputChar?.toLowerCase() === "q" && !input) {
        exit();
        return;
      }
      if (mode === "loading") return;
      if (mode === "detail" && selectedSeat?.needsUser) {
        const forwarded = approvalInputForKey(inputChar, key);
        if (forwarded !== undefined) {
          void forwardAgentInput(selectedSeat, forwarded);
          return;
        }
      }
      if (key.meta && inputChar?.toLowerCase() === "s") {
        clearInput();
        setMode((current) => (current === "tool-select" && seats.length > 0 ? "room" : "tool-select"));
        return;
      }
      if (key.escape) {
        if (mode === "detail") {
          clearInput();
          setMode("room");
          return;
        }
        if (mode === "room") {
          clearInput();
          setMode("tool-select");
          return;
        }
        clearInput();
        return;
      }
      if (mode === "tool-select") {
        if (inputChar?.toLowerCase() === "r") {
          void restoreAgentList();
          return;
        }
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
      if (mode === "detail") {
        if (key.upArrow || key.pageUp || key.downArrow || key.pageDown) {
          const delta = key.pageUp ? -deskScrollPageSize : key.pageDown ? deskScrollPageSize : key.upArrow ? -1 : 1;
          setDeskScroll((value) => clampDeskScroll(value + delta, deskLines.length));
          return;
        }
      }
      if (key.leftArrow) {
        if (input) {
          setInputCursor((value) => Math.max(0, value - 1));
          return;
        }
        setSelected((value) => Math.max(0, value - 1));
        return;
      }
      if (key.rightArrow) {
        if (input) {
          setInputCursor((value) => Math.min(inputLength(input), value + 1));
          return;
        }
        setSelected((value) => Math.min(seats.length - 1, value + 1));
        return;
      }
      if (key.return) {
        if (input.trim().startsWith("/") && mode === "room") {
          void handleClassroomCommand(input.trim());
          clearInput();
          return;
        }
        if (!input.trim() && mode === "room" && selectedSeat) {
          setMode("detail");
          return;
        }
        if (!input.trim() && mode === "detail") return;
        if (mode === "detail" && selectedSeat && input.trim().startsWith("/")) {
          void handleAgentCommand(selectedSeat, input.trim());
          clearInput();
          return;
        }
        try {
          const parsed = parseDispatchWithDefaultTarget(input, selectedSeat?.id);
          focusSeatDetail(parsed.targetSeatId);
          void dispatchFromInput(parsed);
        } catch (error) {
          setDeskLines([error instanceof Error ? error.message : String(error)]);
        }
        clearInput();
        return;
      }
      if (key.backspace) {
        deleteInputBeforeCursor();
        return;
      }
      if (key.delete) {
        deleteInputAtCursor();
        return;
      }
      if ((mode === "room" || mode === "detail") && key.ctrl && inputChar?.toLowerCase() === "x" && selectedSeat) {
        void stopSelectedSeat(selectedSeat);
        return;
      }
      if (inputChar) insertInputAtCursor(inputChar);
    },
    { isActive: interactive },
  );

  function clearInput(): void {
    setInput("");
    setInputCursor(0);
  }

  function insertInputAtCursor(value: string): void {
    const currentChars = Array.from(input);
    const insertChars = Array.from(value);
    const cursor = clampInputCursor(inputCursor, currentChars.length);
    const nextChars = [
      ...currentChars.slice(0, cursor),
      ...insertChars,
      ...currentChars.slice(cursor),
    ];
    setInput(nextChars.join(""));
    setInputCursor(cursor + insertChars.length);
  }

  function deleteInputBeforeCursor(): void {
    const currentChars = Array.from(input);
    const cursor = clampInputCursor(inputCursor, currentChars.length);
    if (cursor === 0) return;
    const nextChars = [
      ...currentChars.slice(0, cursor - 1),
      ...currentChars.slice(cursor),
    ];
    setInput(nextChars.join(""));
    setInputCursor(cursor - 1);
  }

  function deleteInputAtCursor(): void {
    const currentChars = Array.from(input);
    const cursor = clampInputCursor(inputCursor, currentChars.length);
    if (cursor >= currentChars.length) return;
    const nextChars = [
      ...currentChars.slice(0, cursor),
      ...currentChars.slice(cursor + 1),
    ];
    setInput(nextChars.join(""));
    setInputCursor(cursor);
  }

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
      await persistRoomSettings(nextSeats, projectRoot, allowDirty);
      syncSessionId(nextSessionId);
      setSeats(nextSeats);
      setSelected(nextSelected >= 0 ? nextSelected : 0);
      clearInput();
      setMode("room");
      setDeskLines([
        `Created ${seatId}.`,
        `Workspace: ${projectRoot}`,
        "Press Enter to open this agent.",
        "Press Esc to return to tool selection.",
      ]);
    } catch (error) {
      setDeskLines([`Create agent failed: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  async function dispatchFromInput(parsed: { targetSeatId: string; sourceSeatIds: string[]; instruction: string }): Promise<void> {
    const projectRoot = process.cwd();
    const targetSeat = seats.find((seat) => seat.id === parsed.targetSeatId);
    if (!targetSeat) {
      setDeskLines([
        `Agent not found: ${parsed.targetSeatId}`,
        "Create the agent first from the tool selection view, then dispatch to it.",
      ]);
      setMode(seats.length > 0 ? "room" : "tool-select");
      return;
    }
    const missingSourceSeatIds = parsed.sourceSeatIds.filter((seatId) => !seats.some((seat) => seat.id === seatId));
    if (missingSourceSeatIds.length > 0) {
      focusSeatDetail(parsed.targetSeatId);
      setDeskLines([
        `Source agent not found: ${missingSourceSeatIds.join(", ")}`,
        "Referenced source agents must be visible in this workspace session.",
      ]);
      return;
    }
    const nextSessionId = await ensureSessionId(projectRoot);
    syncSessionId(nextSessionId);
    focusSeatDetail(parsed.targetSeatId);
    dispatchingRef.current = true;
    try {
      await recordUserMessage(nextSessionId, parsed.targetSeatId, parsed.instruction, projectRoot);
      await refreshSeatDetail(nextSessionId, parsed.targetSeatId, targetSeat, projectRoot);
      const result = await runSeatAssignment({
        projectRoot,
        sessionId: nextSessionId,
        runner: runnerTypeFromSeatId(parsed.targetSeatId),
        seatId: parsed.targetSeatId,
        instruction: parsed.instruction,
        sourceSeatIds: parsed.sourceSeatIds,
        controlMode: seats.find((seat) => seat.id === parsed.targetSeatId)?.controlMode ?? defaultControlMode,
        allowDirty,
        onEvent: (event) => {
          const eventSeatId = "seatId" in event ? event.seatId : undefined;
          if (eventSeatId !== parsed.targetSeatId) return;
          return refreshSeatDetail(nextSessionId, parsed.targetSeatId, targetSeat, projectRoot, event);
        },
      });
      const detailLines = await buildSeatDetailLines(nextSessionId, parsed.targetSeatId, targetSeat, projectRoot);
      setDeskLines([
        ...detailLines,
        result.status === "done"
          ? `#system Dispatch completed: ${parsed.targetSeatId}`
          : result.status === "stopped"
            ? `#system Dispatch stopped: ${parsed.targetSeatId}`
            : `#error Dispatch failed: ${summarizeDispatchError(result.error)}`,
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
    latestEvent?: AgentRoomEvent,
  ): Promise<void> {
    const state = await readSeatState(nextSessionId, targetSeatId, projectRoot);
    if (state) {
      const nextView = seatStateToView(targetSeatId, state);
      setSeats((current) => current.map((seat) => (seat.id === targetSeatId ? nextView : seat)).sort(compareSeats));
    }
    setDeskLines(await buildSeatDetailLines(nextSessionId, targetSeatId, targetSeat, projectRoot, latestEvent));
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
      const nextSeats = await deleteAgentSeat(seat);
      setMode(nextSeats.length > 0 ? "room" : "tool-select");
      return;
    }
    if (command === "allow-dirty") {
      await handleAllowDirtyCommand(arg);
      return;
    }
    setDeskLines([`Unknown classroom command: /${command}`, "Type /help to see available classroom commands."]);
  }

  async function handleAllowDirtyCommand(arg: string | undefined): Promise<void> {
    const projectRoot = process.cwd();
    const normalized = arg?.trim().toLowerCase();
    if (!normalized) {
      setDeskLines([
        `Allow-dirty is ${allowDirty ? "on" : "off"}.`,
        allowDirty
          ? "Agents will dispatch even when the primary workspace has uncommitted changes."
          : "Dispatch is blocked when the primary workspace has uncommitted changes.",
        "Use /allow-dirty on to permit dispatch on a dirty workspace.",
        "Use /allow-dirty off to require a clean workspace before dispatch.",
      ]);
      return;
    }
    let nextValue: boolean;
    if (normalized === "on" || normalized === "true" || normalized === "1" || normalized === "yes") {
      nextValue = true;
    } else if (normalized === "off" || normalized === "false" || normalized === "0" || normalized === "no") {
      nextValue = false;
    } else {
      setDeskLines([`Unknown allow-dirty value: ${arg}`, "Use /allow-dirty on or /allow-dirty off."]);
      return;
    }
    setAllowDirty(nextValue);
    await persistRoomSettings(seats, projectRoot, nextValue);
    setDeskLines([
      `Allow-dirty is now ${nextValue ? "on" : "off"}.`,
      nextValue
        ? "Uncommitted changes in the primary workspace will NOT block dispatch. Agents run on HEAD in an isolated worktree, so those changes are invisible to them."
        : "Dispatch will refuse to start until the primary workspace is clean (commit or stash first).",
    ]);
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
          setMode("room");
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
      await persistRoomSettings(restoredSeats, projectRoot, allowDirty);
      setSeats(restoredSeats);
      setSelected((value) => Math.min(value, Math.max(restoredSeats.length - 1, 0)));
      setMode("room");
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

  async function forwardAgentInput(seat: SeatView, data: string): Promise<void> {
    if (!sessionId) return;
    const accepted = await adapterFor(seat.runnerType).sendInput(seat.id, data);
    if (!accepted) {
      setDeskLines([`No upstream input channel is active for ${seat.id}.`]);
      return;
    }
    const projectRoot = process.cwd();
    const existing = await readSeatState(sessionId, seat.id, projectRoot);
    const ts = new Date().toISOString();
    const decisionInput = !data.startsWith("\x1b[");
    const nextState = existing?.state === "waiting_user" && decisionInput ? "running" : existing?.state ?? seat.state;
    const nextNeedsUser = existing?.state === "waiting_user" && !decisionInput;
    await appendTranscript(sessionId, seat.id, `AgentRoom: forwarded approval input (${formatForwardedInput(data)})\n`, projectRoot);
    await writeSeatState(
      sessionId,
      {
        seatId: seat.id,
        runnerType: existing?.runnerType ?? seat.runnerType,
        state: nextState,
        currentTask: existing?.currentTask ?? seat.currentTask,
        currentAction: decisionInput ? "approval input forwarded" : "approval selection forwarded",
        workspacePath: existing?.workspacePath ?? seat.workspacePath ?? projectRoot,
        controlMode: existing?.controlMode ?? seat.controlMode,
        processId: existing?.processId,
        startedAt: existing?.startedAt ?? seat.startedAt,
        finishedAt: existing?.finishedAt ?? seat.finishedAt,
        error: existing?.error,
        needsUser: nextNeedsUser,
        updatedAt: ts,
      },
      projectRoot,
    );
    setSeats((current) =>
      current.map((candidate) =>
        candidate.id === seat.id
          ? {
              ...candidate,
              state: candidate.state === "waiting_user" && decisionInput ? "running" : candidate.state,
              currentAction: decisionInput ? "approval input forwarded" : "approval selection forwarded",
              needsUser: candidate.needsUser && !decisionInput,
            }
          : candidate,
      ),
    );
    await refreshSeatDetail(sessionId, seat.id, seat, projectRoot);
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
      const nextSeats = await deleteAgentSeat(seat);
      setMode(nextSeats.length > 0 ? "room" : "tool-select");
      return;
    }
    if (command === "stop") {
      await stopSelectedSeat(seat);
      return;
    }
    if (command === "allow-dirty") {
      await handleAllowDirtyCommand(arg);
      return;
    }
    if (command === "clear" || command === "clear-context" || command === "clearctx" || command === "reset-context") {
      await clearAgentContext(seat);
      return;
    }
    const shortcutMode = parseControlMode(command);
    if (shortcutMode) {
      await setSeatControlMode(seat, shortcutMode);
      return;
    }
    setDeskLines([`Unknown command: /${command}`, "Type /help to see available agent commands."]);
  }

  async function clearAgentContext(seat: SeatView): Promise<void> {
    if (!sessionId) return;
    if (seat.state === "running" || seat.state === "queued" || seat.state === "waiting_user") {
      setDeskLines([
        `Cannot clear context while ${seat.id} is ${seat.state}.`,
        "Wait for the current run to finish or stop the agent first.",
      ]);
      return;
    }
    const projectRoot = process.cwd();
    const { createCollabManager } = await import("../collab/index.js");
    const collabManager = createCollabManager(projectRoot);
    await collabManager.clearSeat(sessionId, seat.id);
    setDeskLines([
      `Cleared context for ${seat.name}.`,
      "Context index emptied. Disk files preserved for audit.",
    ]);
    await refreshSeatDetail(sessionId, seat.id, seat, projectRoot);
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
    await persistRoomSettings(nextSeats, projectRoot, allowDirty);
    setSeats(nextSeats);
    setDeskLines([
      `${seat.name} mode switched to ${formatControlMode(controlMode)}.`,
      controlModeDescription(controlMode),
    ]);
  }

  async function stopSelectedSeat(seat: SeatView): Promise<void> {
    if (!sessionId) return;
    const projectRoot = process.cwd();
    const existing = await readSeatState(sessionId, seat.id, projectRoot);
    await adapterFor(seat.runnerType).stop(seat.id, existing?.processId);
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

  async function deleteAgentSeat(seat: SeatView): Promise<SeatView[]> {
    const projectRoot = process.cwd();
    if (seat.state === "running" || seat.state === "queued") {
      const existing = sessionId ? await readSeatState(sessionId, seat.id, projectRoot) : undefined;
      await adapterFor(seat.runnerType).stop(seat.id, existing?.processId);
    }
    const nextSeats = seats.filter((current) => current.id !== seat.id).sort(compareSeats);
    await persistRoomSettings(nextSeats, projectRoot, allowDirty);
    setSeats(nextSeats);
    setSelected((value) => Math.min(value, Math.max(nextSeats.length - 1, 0)));
    clearInput();
    setDeskLines([
      `Deleted ${seat.id} from this classroom.`,
      "Historical session files were kept under .agentroom/sessions.",
    ]);
    return nextSeats;
  }

  const header = useMemo(() => (sessionId ? `session ${sessionId}` : "no active session"), [sessionId]);
  const selectedRunnerType = runnerChoices[selectedRunner];
  const selectedRunnerMeta = runnerTheme[selectedRunnerType];
  const isLoading = mode === "loading";
  const isToolSelect = mode === "tool-select";
  const isDetail = mode === "detail";
  const activeAccent = isToolSelect ? selectedRunnerMeta.color : selectedSeat ? runnerTheme[selectedSeat.runnerType].color : tuiTheme.borderActive;
  const terminalColumns = typeof stdout.columns === "number" && stdout.columns > 0 ? stdout.columns : 80;
  const appWidth = Math.max(1, terminalColumns - 1);
  const headerMeta = [
    { label: "view", value: formatAppMode(mode) },
    { label: "agents", value: String(seats.length) },
    { label: "workspace", value: compactPath(process.cwd(), 44) },
    { label: "allow-dirty", value: allowDirty ? "on" : "off" },
  ];

  return (
    <Box flexDirection="column" rowGap={1} width={appWidth}>
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
                    <Text color={tuiTheme.dim}>No agents yet. Press Alt+S to add one.</Text>
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
        editable={(mode === "room" || mode === "detail") && !(mode === "detail" && selectedSeat?.needsUser)}
        input={input}
        cursorIndex={inputCursor}
        placeholder={
          isLoading
            ? "Starting a fresh classroom session..."
            : isToolSelect
              ? `${selectedRunnerMeta.label} selected - Enter creates ${nextSeatId(selectedRunnerType, seats)}, r restores${seats.length > 0 ? ", b returns" : ""}, q exits`
              : isDetail
                ? selectedSeat?.needsUser
                  ? "upstream confirmation: y/a/Enter approve, s approve for session, n/r reject, Esc/c cancel"
                  : `type a message to ${selectedSeat?.name ?? "the selected agent"} or /help; Up/Down/PageUp/PageDown scroll; Ctrl+X stops; Esc returns`
                : `type a task for ${selectedSeat?.name ?? "the selected agent"} or /help; Alt+S adds an agent${selectedSeat ? ", Enter opens on empty input, arrows switch" : ""}, Ctrl+C exits`
        }
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

function PromptLine({
  editable,
  input,
  cursorIndex,
  placeholder,
  accentColor,
}: {
  editable: boolean;
  input: string;
  cursorIndex: number;
  placeholder: string;
  accentColor: string;
}): React.ReactElement {
  const hasInput = input.length > 0;
  const showEditor = editable;
  const borderColor = showEditor ? accentColor : tuiTheme.border;
  const label = showEditor ? "cmd  " : "hint ";

  return (
    <Box borderStyle="single" borderColor={borderColor} paddingX={1}>
      <Text color={accentColor} bold>{label}</Text>
      {showEditor ? (
        <EditablePromptText input={input} cursorIndex={cursorIndex} placeholder={placeholder} />
      ) : (
        <Text color={hasInput ? tuiTheme.text : tuiTheme.dim}>{hasInput ? input : placeholder}</Text>
      )}
    </Box>
  );
}

function EditablePromptText({
  input,
  cursorIndex,
  placeholder,
}: {
  input: string;
  cursorIndex: number;
  placeholder: string;
}): React.ReactElement {
  if (input.length === 0) {
    return (
      <>
        <Text color={tuiTheme.text} inverse>{" "}</Text>
        <Text color={tuiTheme.dim}>{placeholder ? ` ${placeholder}` : ""}</Text>
      </>
    );
  }
  const chars = Array.from(input);
  const cursor = clampInputCursor(cursorIndex, chars.length);
  const before = chars.slice(0, cursor).join("");
  const current = chars[cursor] ?? " ";
  const after = chars.slice(cursor + 1).join("");

  return (
    <>
      {before ? <Text color={tuiTheme.text}>{before}</Text> : null}
      <Text color={tuiTheme.text} inverse>{current}</Text>
      {after ? <Text color={tuiTheme.text}>{after}</Text> : null}
    </>
  );
}

function inputLength(value: string): number {
  return Array.from(value).length;
}

function clampInputCursor(value: number, length: number): number {
  return Math.min(Math.max(0, value), length);
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
    needsUser: Boolean(state?.needsUser || state?.state === "waiting_user"),
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

async function persistRoomSettings(seats: SeatView[], projectRoot: string, allowDirty: boolean): Promise<void> {
  await writeRoomSettings(
    {
      seats: [...seats].sort(compareSeats).map((seat) => ({
        seatId: seat.id,
        runnerType: seat.runnerType,
        controlMode: seat.controlMode,
      })),
      allowDirty,
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
      a.needsUser !== b.needsUser ||
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
  latestEvent?: AgentRoomEvent,
): Promise<string[]> {
  const [state, transcript] = await Promise.all([
    readSeatState(sessionId, seatId, projectRoot),
    readTranscript(sessionId, seatId, projectRoot),
  ]);
  const seat = state ? seatStateToView(seatId, state) : fallbackSeat;
  const lines: string[] = [
    `#meta Seat: ${seat?.name ?? seatIdToDisplayName(seatId)} (${seatId})`,
    `#meta Workspace: ${seat?.workspacePath ?? process.cwd()}`,
    `#meta Mode: ${formatControlMode(seat?.controlMode ?? defaultControlMode)}`,
    `#meta Task: ${seat?.currentTask ?? "Idle"}`,
    `#meta Now: ${seat?.currentAction ?? seat?.stateText ?? "idle"}`,
    `#meta Commands: /help, /mode [plan|accept|full], /clear`,
    "#meta Scroll: Up/Down, PageUp/PageDown",
    "",
  ];

  if (state?.state === "failed" && state.error) {
    lines.push(`#error ${summarizeDispatchError(state.error)}`, "");
  }
  if (seat?.needsUser) {
    lines.push(
      "#approval Upstream CLI is waiting for confirmation.",
      "#approval y/a/Enter approve, s approve for session, n/r reject, Esc/c cancel.",
      "",
    );
  }

  const liveStatus = liveStatusLine(seat);
  if (liveStatus) lines.push(liveStatus, "");

  if (transcript.length > 0) {
    const latestLine = latestEventToTranscriptLine(latestEvent);
    const visibleLines = appendUniqueTail(
      transcript.map(formatTranscriptLine).filter((line) => line.trim() && !isGenericHeartbeatLine(line)),
      latestLine,
    );
    const grouped = groupTranscriptLines(visibleLines);
    lines.push(
      "#meta Conversation / final results",
      ...(grouped.results.length ? grouped.results : ["#thinking No final answer lines yet."]),
      "",
      "#meta Thinking / process",
      ...(grouped.thinking.length ? grouped.thinking : ["#thinking No thinking or process lines yet."]),
      "",
    );
  } else {
    const latestLine = latestEventToTranscriptLine(latestEvent);
    lines.push(
      "#meta Conversation / final results",
      latestLine && isResultTranscriptLine(latestLine) ? latestLine : "#thinking Waiting for the first final answer...",
      "",
      "#meta Thinking / process",
      latestLine && !isResultTranscriptLine(latestLine) ? latestLine : "#thinking Waiting for the first agent event...",
      "",
    );
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
    case "context.entry_recorded":
      return `${ts} context entry recorded: ${event.kind}`;
    case "context.collab_opened":
      return `${ts} collab opened: ${event.collabId}`;
    case "context.collab_closed":
      return `${ts} collab closed: ${event.collabId}`;
    case "context.seat_cleared":
      return `${ts} context cleared`;
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
    "/mode accept - normal work with routine file edits allowed",
    "/mode full - run end-to-end with full control",
    "/stop - stop the running agent (Ctrl+X or clear input and press s)",
    "/delete - remove this agent from the classroom",
    "/allow-dirty [on|off] - toggle dispatch on a dirty workspace (classroom-wide)",
    "/clear - clear this agent's handoff context for future dispatches",
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
    "/allow-dirty - show whether dispatch is allowed on a dirty workspace",
    "/allow-dirty on - permit dispatch when uncommitted changes exist (agents still run against HEAD)",
    "/allow-dirty off - require a clean workspace before dispatch",
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
      return "Accept mode: the agent can work in the workspace with routine file edits allowed.";
    case "full":
      return "Full control mode: Codex runs with approvals and sandbox bypassed for this agent.";
  }
}

type InkInputKey = {
  return?: boolean;
  escape?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  ctrl?: boolean;
};

function approvalInputForKey(inputChar: string | undefined, key: InkInputKey): string | undefined {
  if (key.ctrl) return undefined;
  if (key.return) return "\r";
  if (key.escape) return "c";
  if (key.upArrow) return "\x1b[A";
  if (key.downArrow) return "\x1b[B";
  if (key.leftArrow) return "\x1b[D";
  if (key.rightArrow) return "\x1b[C";
  const normalized = inputChar?.toLowerCase();
  if (normalized && ["y", "a", "s", "n", "r", "c"].includes(normalized)) return `${normalized}\r`;
  return undefined;
}

function formatForwardedInput(data: string): string {
  const normalized = data.replace(/\r/g, "Enter").replace(/\x1b/g, "Esc");
  return normalized.trim() || "Enter";
}

function normalizeSeatId(value: string): string {
  const normalized = value.trim().replace(/^@/, "").replace("#", "-").toLowerCase();
  return normalized;
}

function summarizeDispatchError(error: string | undefined): string {
  if (!error) return "runner failed";
  const lines = error.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const meaningful = [...lines].reverse().find((line) => /ERROR:|error:|Forbidden|Unauthorized|timeout|超时|退出码/.test(line)) ?? lines.at(-1);
  if (!meaningful) return "runner failed";
  return meaningful.length <= 160 ? meaningful : `${meaningful.slice(0, 157)}...`;
}

function formatTranscriptLine(line: string): string {
  const trimmed = line.trim();
  if (/^(ERROR|error):/.test(trimmed) || /Forbidden|Unauthorized|authentication|permission denied|退出码|超时/i.test(trimmed)) {
    return `#error ${trimmed}`;
  }
  return line;
}

function liveStatusLine(seat: SeatView | undefined): string | undefined {
  if (!seat) return undefined;
  const action = seat.currentAction?.replace(/\s+/g, " ").trim();
  switch (seat.state) {
    case "queued":
      return "#thinking Queued and waiting to start...";
    case "running":
      return `#thinking ${seat.name} ${action && action !== "running" ? action : "is thinking..."}`;
    case "waiting_user":
      return "#approval Waiting for user confirmation.";
    default:
      return undefined;
  }
}

function latestEventToTranscriptLine(event: AgentRoomEvent | undefined): string | undefined {
  if (!event) return undefined;
  if (event.type === "activity.appended") return formatTranscriptLine(event.text);
  if (event.type === "seat.state_changed") return `#system State changed: ${event.state}`;
  if (event.type === "assignment.started") return `#system Assignment started: ${event.assignmentId}`;
  if (event.type === "assignment.completed") return `#system Assignment completed: ${event.assignmentId}`;
  if (event.type === "assignment.failed") return `#error Assignment failed: ${event.error}`;
  if (event.type === "file.changed") return `#tool File ${event.changeType}: ${event.path}`;
  return undefined;
}

function appendUniqueTail(lines: string[], line: string | undefined): string[] {
  if (!line || !line.trim()) return lines;
  return lines.at(-1) === line ? lines : [...lines, line];
}

function groupTranscriptLines(lines: string[]): { results: string[]; thinking: string[] } {
  const results: string[] = [];
  const thinking: string[] = [];
  for (const line of lines) {
    if (isResultTranscriptLine(line)) {
      results.push(line);
    } else {
      thinking.push(line);
    }
  }
  return { results, thinking };
}

function isResultTranscriptLine(line: string): boolean {
  return (
    line.startsWith("User: ") ||
    line.startsWith("Claude: ") ||
    line.startsWith("Codex: ") ||
    line.startsWith("Gemini: ") ||
    line.startsWith("#assistant ") ||
    line.startsWith("#result ")
  );
}

function isGenericHeartbeatLine(line: string): boolean {
  return /^#thinking (?:Codex|Claude|Gemini) is thinking\.\.\.$/.test(line.trim());
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
