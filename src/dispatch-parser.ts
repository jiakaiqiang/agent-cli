import type { RunnerType } from "./types.js";

export type ParsedDispatch = {
  targetSeatId: string;
  sourceSeatIds: string[];
  instruction: string;
};

const seatRefPattern = /@(codex|claude|gemini)#(\d+)/gi;

export function parseDispatch(input: string): ParsedDispatch {
  const refs = [...input.matchAll(seatRefPattern)];
  if (refs.length === 0) {
    throw new Error("派发指令必须包含目标座位，例如 @codex#1。");
  }

  const target = toSeatId(refs[0][1] as RunnerType, refs[0][2]);
  const sourceSeatIds = refs
    .slice(1)
    .map((match) => toSeatId(match[1] as RunnerType, match[2]))
    .filter((seatId, index, all) => all.indexOf(seatId) === index);

  const instruction = input.replace(refs[0][0], "").trim();
  if (!instruction) {
    throw new Error("目标座位后必须填写任务说明。");
  }

  return {
    targetSeatId: target,
    sourceSeatIds,
    instruction,
  };
}

export function toSeatId(type: RunnerType, index: string | number): string {
  return `${type.toLowerCase()}-${index}`;
}

export function seatIdToDisplayName(seatId: string): string {
  const [type, index] = seatId.split("-");
  const title = type ? `${type[0]?.toUpperCase()}${type.slice(1)}` : "Seat";
  return `${title} #${index ?? "?"}`;
}

export function runnerTypeFromSeatId(seatId: string): RunnerType {
  const type = seatId.split("-")[0];
  if (type === "codex" || type === "claude" || type === "gemini") return type;
  throw new Error(`不支持的座位 ID：${seatId}`);
}
