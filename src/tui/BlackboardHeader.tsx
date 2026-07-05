import React from "react";
import { Box, Text } from "ink";
import { tuiTheme } from "./theme.js";

export function BlackboardHeader({
  title,
  subtitle,
  meta = [],
}: {
  title: string;
  subtitle?: string;
  meta?: Array<{ label: string; value: string }>;
}): React.ReactElement {
  return (
    <Box borderStyle="double" borderColor={tuiTheme.borderActive} paddingX={1} flexDirection="column">
      <Box>
        <Text bold color={tuiTheme.accent}>AgentRoom</Text>
        <Text color={tuiTheme.dim}> / </Text>
        <Text bold color={tuiTheme.text}>{title}</Text>
      </Box>
      {subtitle ? <Text color={tuiTheme.dim}>{subtitle}</Text> : null}
      {meta.length > 0 ? (
        <Box columnGap={2} flexWrap="wrap">
          {meta.map((item) => (
            <Text key={item.label}>
              <Text color={tuiTheme.dim}>{item.label}: </Text>
              <Text color={tuiTheme.text}>{item.value}</Text>
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
