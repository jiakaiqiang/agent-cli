import React from "react";
import { Box, Text } from "ink";
import type { SeatView } from "../types.js";
import { runnerTheme, tuiTheme } from "./theme.js";

export function SeatCard({ seat, selected }: { seat: SeatView; selected: boolean }): React.ReactElement {
  const runner = runnerTheme[seat.runnerType];
  const accent = selected ? runner.color : tuiTheme.dim;
  const taskLines = wrapText(seat.currentTask ?? "Idle", 36, 2);
  const action = compactLine(seat.currentAction ?? seat.stateText ?? "idle", 38);

  return (
    <Box
      borderStyle="single"
      borderColor={selected ? runner.color : tuiTheme.border}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      width={46}
      minHeight={9}
      flexShrink={0}
    >
      <Box justifyContent="space-between">
        <Text>
          <Text color={accent}>{selected ? "> " : "  "}[{runner.short}] </Text>
          <Text bold color={selected ? tuiTheme.text : accent}>{seat.name}</Text>
        </Text>
        <Text color={stateColor(seat.state)}>{formatSeatState(seat.state)}</Text>
      </Box>
      <Text color={tuiTheme.dim}>{runner.label} / {compactPath(seat.workspacePath ?? "-")}</Text>
      <Text color={tuiTheme.meta}>task</Text>
      {taskLines.map((line, index) => (
        <Text key={`task-${index}`} color={tuiTheme.text}>{index === 0 ? `  ${line}` : `  ${line}`}</Text>
      ))}
      <Box justifyContent="space-between">
        <Text color={tuiTheme.dim}>mode {formatControlMode(seat.controlMode)}</Text>
        <Text color={tuiTheme.dim}>{formatDuration(seat.runtimeMs)}</Text>
      </Box>
      <Text color={selected ? tuiTheme.text : tuiTheme.dim} wrap="truncate-end">now  {action}</Text>
    </Box>
  );
}

function formatSeatState(state: SeatView["state"]): string {
  switch (state) {
    case "idle":
      return "idle";
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
  }
}

function stateColor(state: SeatView["state"]): string {
  switch (state) {
    case "running":
    case "done":
      return tuiTheme.accent;
    case "failed":
      return tuiTheme.error;
    case "queued":
      return tuiTheme.warning;
    default:
      return tuiTheme.dim;
  }
}

function formatControlMode(controlMode: SeatView["controlMode"]): string {
  switch (controlMode) {
    case "plan":
      return "plan";
    case "accept":
      return "accept";
    case "full":
      return "full";
  }
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

function compactPath(value: string): string {
  const normalized = value.replace(/\//g, "\\").trim();
  if (normalized.length <= 34) return normalized;
  const parts = normalized.split("\\").filter(Boolean);
  const tail = parts.slice(-2).join("\\");
  return tail.length <= 31 ? `...\\${tail}` : `...${normalized.slice(-31)}`;
}


function compactLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim() || "-";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function wrapText(value: string, lineLength: number, maxLines: number): string[] {
  const normalized = value.replace(/\s+/g, " ").trim() || "-";
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > lineLength) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += lineLength) {
        lines.push(word.slice(index, index + lineLength));
      }
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > lineLength) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  visible[maxLines - 1] = `${visible[maxLines - 1].slice(0, Math.max(0, lineLength - 3))}...`;
  return visible;
}
