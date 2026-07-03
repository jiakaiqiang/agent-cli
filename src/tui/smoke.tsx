import React from "react";
import { render } from "ink";
import { AgentRoomApp } from "./App.js";

const instance = render(<AgentRoomApp interactive={false} />);

setTimeout(() => {
  instance.unmount();
  console.log("TUI 烟测挂载成功。");
}, 250);
