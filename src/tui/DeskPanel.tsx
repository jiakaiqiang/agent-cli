import React from "react";
import { Box, Text } from "ink";

export function DeskPanel({ title, lines }: { title: string; lines: string[] }): React.ReactElement {
  return (
    <Box borderStyle="single" paddingX={1} flexDirection="column">
      <Text bold>座位详情：{title}</Text>
      {lines.map((line, index) => (
        <Text key={`${index}-${line.slice(0, 16)}`}>{line}</Text>
      ))}
    </Box>
  );
}
