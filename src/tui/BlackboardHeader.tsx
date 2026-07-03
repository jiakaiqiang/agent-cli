import React from "react";
import { Box, Text } from "ink";

export function BlackboardHeader({ title }: { title: string }): React.ReactElement {
  return (
    <Box borderStyle="round" paddingX={1}>
      <Text bold>{title}</Text>
    </Box>
  );
}

