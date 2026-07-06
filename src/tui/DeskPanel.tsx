import React from "react";
import { Box, Text } from "ink";
import { tuiTheme } from "./theme.js";

export function DeskPanel({
  title,
  lines,
  height = 20,
  scrollOffset = 0,
  accentColor = tuiTheme.borderActive,
}: {
  title: string;
  lines: string[];
  height?: number;
  scrollOffset?: number;
  accentColor?: string;
}): React.ReactElement {
  const visibleLineCount = Math.max(1, height - 5);
  const maxOffset = Math.max(0, lines.length - visibleLineCount);
  const offset = Math.min(Math.max(0, scrollOffset), maxOffset);
  const visibleLines = lines.slice(offset, offset + visibleLineCount);
  const paddedLines = [...visibleLines, ...Array.from({ length: Math.max(0, visibleLineCount - visibleLines.length) }, () => "")];
  const scrollLabel = maxOffset > 0 ? `lines ${offset + 1}-${Math.min(lines.length, offset + visibleLineCount)}/${lines.length}` : "";

  return (
    <Box borderStyle="single" borderColor={accentColor} paddingX={1} flexDirection="column" height={height} overflow="hidden">
      <Box justifyContent="space-between">
        <Text>
          <Text bold color={accentColor}>{title}</Text>
          <Text color={tuiTheme.dim}> / transcript</Text>
        </Text>
        <Text color={tuiTheme.dim}>{scrollLabel}</Text>
      </Box>
      <Text color={tuiTheme.dim}>{"-".repeat(72)}</Text>
      {paddedLines.map((line, index) => renderLine(line, `row-${index}`))}
    </Box>
  );
}

function renderLine(line: string, key: string): React.ReactElement {
  if (line.startsWith("#meta ")) {
    return <Text key={key} color={tuiTheme.meta}>{line.slice(6)}</Text>;
  }
  if (line.startsWith("#thinking ")) {
    return <Text key={key} color={tuiTheme.dim}>{`  ${line.slice(10)}`}</Text>;
  }
  if (line.startsWith("#assistant ")) {
    return <Text key={key} color={tuiTheme.agent}>{line.slice(11)}</Text>;
  }
  if (line.startsWith("#tool ")) {
    return <Text key={key} color={tuiTheme.input}>{`> ${line.slice(6)}`}</Text>;
  }
  if (line.startsWith("#tool-result ")) {
    return <Text key={key} color={tuiTheme.input} dimColor>{`  ${line.slice(13)}`}</Text>;
  }
  if (line.startsWith("#approval ")) {
    return <Text key={key} color={tuiTheme.warning}>{line.slice(10)}</Text>;
  }
  if (line.startsWith("#terminal ")) {
    return <Text key={key} color={tuiTheme.text}>{line.slice(10)}</Text>;
  }
  if (line.startsWith("#system ")) {
    return <Text key={key} color={tuiTheme.system}>{line.slice(8)}</Text>;
  }
  if (line.startsWith("#result ")) {
    return <Text key={key} color={tuiTheme.agent} bold>{line.slice(8)}</Text>;
  }
  if (line.startsWith("#error ")) {
    return <Text key={key} color={tuiTheme.error}>{line.slice(7)}</Text>;
  }
  if (line.startsWith("User: ")) {
    return <Text key={key} color={tuiTheme.input}>{`> ${line}`}</Text>;
  }
  if (line.startsWith("AgentRoom: ")) {
    return <Text key={key} color={tuiTheme.warning}>{line}</Text>;
  }
  if (line.startsWith("Claude: ") || line.startsWith("Codex: ") || line.startsWith("Gemini: ")) {
    return <Text key={key} color={tuiTheme.agent}>{line}</Text>;
  }
  if (line.startsWith("#stream ")) {
    return <Text key={key} color={tuiTheme.agent} dimColor>{line.slice(8)}</Text>;
  }
  return <Text key={key} color={tuiTheme.text} wrap="truncate-end">{line}</Text>;
}
