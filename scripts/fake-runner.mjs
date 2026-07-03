import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

if (process.argv.includes("--version")) {
  console.log("agentroom-fake-runner 0.1.0");
  process.exit(0);
}

const stdinPrompt = readStdin();
const prompt = process.env.AGENTROOM_RUNNER_PROMPT || stdinPrompt || process.argv.slice(2).join(" ");
if (prompt.includes("agentroom-probe-ok")) {
  console.log("agentroom-probe-ok");
  process.exit(0);
}

console.log("模拟 runner 已启动");
console.log(prompt.slice(0, 160));
if (prompt.includes("agentroom-sleep")) {
  console.log("模拟 runner 正在休眠");
  setInterval(() => {
    console.log("模拟 runner 仍在休眠");
  }, 1000);
  await new Promise(() => {});
}
if ((prompt.includes("来源座位：") || prompt.includes("Source seat:")) && prompt.includes("README.md")) {
  console.log("已审查来源补丁：README.md 被修改");
}

appendFileSync(join(process.cwd(), "README.md"), "\n\nAgentRoom 模拟 runner 烟测变更。\n");
writeFileSync(
  join(process.cwd(), "AGENTROOM_SUMMARY.md"),
  [
    "---",
    prompt.includes("来源座位：") || prompt.includes("Source seat:")
      ? "summary: 模拟 runner 已审查来源补丁并引用 README.md"
      : "summary: 模拟 runner 为烟测更新了 README",
    "changed_files:",
    "  - README.md",
    "tests: []",
    "claims: []",
    "---",
    "",
    "模拟 runner 已成功完成。",
    "",
  ].join("\n"),
  "utf8",
);

console.log("模拟 runner 已完成");

function readStdin() {
  try {
    return readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
}
