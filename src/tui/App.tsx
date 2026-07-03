import React, { useEffect, useMemo, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import { pathToFileURL } from "node:url";
import { runSeatAssignment } from "../assignment.js";
import { adapterFor } from "../adapters/index.js";
import { parseDispatch, runnerTypeFromSeatId, seatIdToDisplayName } from "../dispatch-parser.js";
import { recoverSession } from "../recovery.js";
import {
  appendEvent,
  createSeat,
  createSession,
  findLatestSessionId,
  listSeatIds,
  readEvents,
  readSeatState,
  readSummary,
  readTranscriptTail,
  writeSeatState,
} from "../storage.js";
import type { RunnerType, SeatStateFile, SeatView } from "../types.js";
import { BlackboardHeader } from "./BlackboardHeader.js";
import { DeskPanel } from "./DeskPanel.js";
import { SeatCard } from "./SeatCard.js";

const runnerChoices: RunnerType[] = ["codex", "claude", "gemini"];
type AppMode = "loading" | "tool-select" | "room";

export function AgentRoomApp({ interactive = true }: { interactive?: boolean }): React.ReactElement {
  const { exit } = useApp();
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [seats, setSeats] = useState<SeatView[]>([]);
  const [selected, setSelected] = useState(0);
  const [selectedRunner, setSelectedRunner] = useState(0);
  const [input, setInput] = useState("");
  const [deskLines, setDeskLines] = useState<string[]>([]);
  const [mode, setMode] = useState<AppMode>("loading");

  useEffect(() => {
    let active = true;
    const load = async () => {
      const latest = await findLatestSessionId();
      if (!latest) {
        if (active) setMode((current) => (current === "loading" ? "tool-select" : current));
        return;
      }
      await recoverSession(latest);
      const seatIds = await listSeatIds(latest);
      const views: SeatView[] = [];
      for (const seatId of seatIds) {
        const state = await readSeatState(latest, seatId);
        views.push(seatStateToView(seatId, state));
      }
      if (active) {
        setSessionId(latest);
        setSeats(views);
        setSelected((value) => Math.min(value, Math.max(views.length - 1, 0)));
        setMode((current) => (current === "loading" ? (views.length > 0 ? "room" : "tool-select") : current));
      }
    };
    void load();
    const timer = setInterval(load, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const selectedSeat = seats[selected];

  useEffect(() => {
    const loadDesk = async () => {
      if (mode === "loading") {
        setDeskLines(["Loading AgentRoom session..."]);
        return;
      }
      if (mode === "tool-select") {
        setDeskLines([
          seats.length === 0 ? "Choose an agent tool to create the first instance." : "Choose another tool to create another agent.",
          "Use Left/Right or 1/2/3, then press Enter.",
          ...(seats.length > 0 ? ["Press b or Backspace to return to the agent list."] : []),
        ]);
        return;
      }
      if (!sessionId || !selectedSeat) {
        setDeskLines([
          "Choose an agent tool to create the first instance.",
          "Use Left/Right or 1/2/3, then press Enter.",
        ]);
        return;
      }
      const [summary, tail, events] = await Promise.all([
        readSummary(sessionId, selectedSeat.id),
        readTranscriptTail(sessionId, selectedSeat.id, 8),
        readEvents(sessionId),
      ]);
      const recentEvents = events
        .filter((event) => "seatId" in event && event.seatId === selectedSeat.id)
        .slice(-5)
        .map((event) => `${event.ts} ${event.type}`);
      setDeskLines([
        `Task: ${selectedSeat.currentTask ?? "-"}`,
        "Recent events:",
        ...(recentEvents.length ? recentEvents : ["(none)"]),
        "Recent transcript:",
        ...(tail.length ? tail : ["(empty)"]),
        "Summary:",
        summary?.trim() || "(empty)",
      ]);
    };
    void loadDesk();
  }, [mode, seats.length, sessionId, selectedSeat]);

  useInput(
    (inputChar, key) => {
      if (key.escape || (key.ctrl && inputChar === "c")) {
        exit();
        return;
      }
      if (mode === "loading") return;
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
      if (inputChar?.toLowerCase() === "a") {
        setInput("");
        setMode("tool-select");
        return;
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
        try {
          const parsed = parseDispatch(input);
          setDeskLines([
            `Dispatch queued: ${parsed.targetSeatId}`,
            `Sources: ${parsed.sourceSeatIds.join(", ") || "-"}`,
            `Instruction: ${parsed.instruction}`,
          ]);
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
      if (inputChar === "s" && selectedSeat) {
        void stopSelectedSeat(selectedSeat);
        return;
      }
      if (inputChar) setInput((value) => `${value}${inputChar}`);
    },
    { isActive: interactive },
  );

  async function createAgentSeat(runner: RunnerType): Promise<void> {
    const projectRoot = process.cwd();
    try {
      const nextSessionId =
        sessionId ??
        (
          await createSession({
            title: `TUI ${runner} agent`,
            projectPath: projectRoot,
          })
        ).id;
      const seatId = nextSeatId(runner, seats);
      const ts = new Date().toISOString();
      const state: SeatStateFile = {
        seatId,
        runnerType: runner,
        state: "idle",
        updatedAt: ts,
      };
      await createSeat(nextSessionId, state, projectRoot);
      await appendEvent(nextSessionId, { type: "seat.state_changed", seatId, state: "idle", ts }, projectRoot);
      const nextSeat = seatStateToView(seatId, state);
      const nextSeats = [...seats, nextSeat].sort((left, right) => left.id.localeCompare(right.id));
      const nextSelected = nextSeats.findIndex((seat) => seat.id === seatId);
      setSessionId(nextSessionId);
      setSeats(nextSeats);
      setSelected(nextSelected >= 0 ? nextSelected : 0);
      setInput("");
      setDeskLines([
        `Created ${seatId}.`,
        "Press Enter to create another agent with the selected tool.",
        "Press b or Backspace to return to the agent list.",
      ]);
    } catch (error) {
      setDeskLines([`Create agent failed: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  async function dispatchFromInput(parsed: { targetSeatId: string; sourceSeatIds: string[]; instruction: string }): Promise<void> {
    const projectRoot = process.cwd();
    const nextSessionId =
      sessionId ??
      (
        await createSession({
          title: parsed.instruction,
          projectPath: projectRoot,
        })
      ).id;
    setSessionId(nextSessionId);
    try {
      await runSeatAssignment({
        projectRoot,
        sessionId: nextSessionId,
        runner: runnerTypeFromSeatId(parsed.targetSeatId),
        seatId: parsed.targetSeatId,
        instruction: parsed.instruction,
        sourceSeatIds: parsed.sourceSeatIds,
      });
      setDeskLines([`Dispatch completed: ${parsed.targetSeatId}`]);
    } catch (error) {
      setDeskLines([`Dispatch failed: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  async function stopSelectedSeat(seat: SeatView): Promise<void> {
    if (!sessionId) return;
    await adapterFor(seat.runnerType).stop(seat.id);
    const ts = new Date().toISOString();
    await writeSeatState(sessionId, {
      seatId: seat.id,
      runnerType: seat.runnerType,
      state: "stopped",
      currentTask: seat.currentTask,
      updatedAt: ts,
    });
    await appendEvent(sessionId, { type: "seat.state_changed", seatId: seat.id, state: "stopped", ts });
    setDeskLines([`Stopped ${seat.id}`]);
  }

  const header = useMemo(() => `AgentRoom ${sessionId ? `- session ${sessionId}` : "- no session"}`, [sessionId]);
  const selectedRunnerType = runnerChoices[selectedRunner];
  const dispatchExample = selectedSeat ? `@${selectedSeat.runnerType}#${selectedSeat.id.split("-")[1] ?? "1"}` : "@codex#1";
  const isToolSelect = mode === "tool-select" || mode === "loading";

  return (
    <Box flexDirection="column">
      <BlackboardHeader title={header} />
      <Box gap={2}>
        {isToolSelect
          ? runnerChoices.map((runner, index) => (
              <Box
                key={runner}
                borderStyle={index === selectedRunner ? "double" : "single"}
                borderColor={index === selectedRunner ? "green" : "gray"}
                paddingX={1}
                flexDirection="column"
                width={22}
              >
                <Text color={runner === "codex" ? "cyan" : runner === "claude" ? "magenta" : "blue"}>
                  {index + 1}. {runner}
                </Text>
                <Text>{index === selectedRunner ? "Press Enter" : "Select tool"}</Text>
              </Box>
            ))
          : seats.map((seat, index) => <SeatCard key={seat.id} seat={seat} selected={index === selected} />)}
      </Box>
      <DeskPanel title={isToolSelect ? "Tool selection" : selectedSeat?.name ?? "Agent detail"} lines={deskLines} />
      <Text color="gray">
        {isToolSelect
          ? `Tool: ${selectedRunnerType} (Enter creates agent${seats.length > 0 ? ", b returns" : ""}, Esc exits)`
          : `Input: ${input || `(type ${dispatchExample} task, a adds agent, arrows switch seats, s stops selected, Esc exits)`}`}
      </Text>
    </Box>
  );
}

function seatStateToView(seatId: string, state: SeatStateFile | undefined): SeatView {
  return {
    id: seatId,
    runnerType: state?.runnerType ?? runnerTypeFromSeatId(seatId),
    name: seatIdToDisplayName(seatId),
    state: state?.state ?? "idle",
    stateText: state?.error ?? state?.state ?? "idle",
    currentTask: state?.currentTask,
    changedFiles: 0,
    runtimeMs: 0,
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  render(<AgentRoomApp />);
}
