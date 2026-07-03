import React from "react";
import { Box, Text } from "ink";
import type { SeatView } from "../types.js";

export function SeatCard({ seat, selected }: { seat: SeatView; selected: boolean }): React.ReactElement {
  const color = seat.runnerType === "codex" ? "cyan" : seat.runnerType === "claude" ? "magenta" : "blue";
  return (
    <Box borderStyle={selected ? "double" : "single"} borderColor={selected ? "green" : color} paddingX={1} flexDirection="column" width={28}>
      <Text color={color}>{seat.name}</Text>
      <Text>状态：{formatSeatState(seat.state)}</Text>
      <Text>任务：{seat.currentTask ?? "-"}</Text>
    </Box>
  );
}

function formatSeatState(state: SeatView["state"]): string {
  switch (state) {
    case "idle":
      return "空闲";
    case "queued":
      return "排队中";
    case "running":
      return "运行中";
    case "done":
      return "已完成";
    case "failed":
      return "失败";
    case "stopped":
      return "已停止";
  }
}
