import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { allAdapters } from "./adapters/index.js";
import { probeDir, writeJson } from "./storage.js";
import { runCapture } from "./adapters/runner.js";

export type ProbeResult = {
  root: string;
  summaries: string[];
};

export async function runProbe(projectRoot = process.cwd()): Promise<ProbeResult> {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const root = path.join(probeDir(projectRoot), runId);
  await mkdir(root, { recursive: true });
  const summaries: string[] = [];
  const skipGitRepoCheck = !(await isGitWorkspace(projectRoot));

  for (const adapter of allAdapters()) {
    const runnerRoot = path.join(root, adapter.type);
    await mkdir(runnerRoot, { recursive: true });
    const probe = await adapter.probe(projectRoot);

    if (probe.available && probe.promptExitCode === undefined) {
      const promptCommand = adapter.promptCommand("请只回复：agentroom-probe-ok", "accept", {
        projectRoot,
        cwd: projectRoot,
        timeoutMs: 30_000,
        skipGitRepoCheck,
      });
      const prompt = await runCapture(promptCommand, projectRoot, 30_000);
      probe.promptExitCode = prompt.exitCode;
      probe.stdout = prompt.stdout;
      probe.stderr = [probe.stderr, prompt.stderr].filter(Boolean).join("\n");
      probe.supportsStreaming = prompt.stdout.includes("\n");
      probe.supportsStructuredOutput = looksStructured(prompt.stdout);
      if (prompt.exitCode !== 0) {
        probe.available = false;
        probe.error = summarizePromptFailure(prompt);
      }
      await writeFile(path.join(runnerRoot, "prompt.stdout.log"), prompt.stdout, "utf8");
      await writeFile(path.join(runnerRoot, "prompt.stderr.log"), prompt.stderr, "utf8");
    }

    await writeJson(path.join(runnerRoot, "probe-result.json"), probe);
    summaries.push(
      [
        `${adapter.displayName}：${probe.available ? "可用" : "不可用"}${probe.version ? `（${probe.version.split(/\r?\n/)[0]}）` : ""}`,
        probe.error ? ` - ${oneLine(probe.error)}` : "",
      ].join(""),
    );
  }

  console.log(`探测结果已写入：${root}`);
  console.log(summaries.join("\n"));
  return { root, summaries };
}

async function isGitWorkspace(projectRoot: string): Promise<boolean> {
  const result = await runCapture({ command: "git", args: ["rev-parse", "--is-inside-work-tree"] }, projectRoot, 10_000);
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

function summarizePromptFailure(prompt: { stdout: string; stderr: string; exitCode: number | null; error?: string }): string {
  const combined = [prompt.error, prompt.stderr, prompt.stdout].filter(Boolean).join("\n").trim();
  if (!combined) return `prompt exited with code ${prompt.exitCode ?? "unknown"}`;
  const lines = combined.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return [...lines].reverse().find((line) => /ERROR:|error:|Forbidden|Unauthorized|timeout|超时|退出码/.test(line)) ?? lines.at(-1) ?? combined;
}

function oneLine(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`;
}

function looksStructured(output: string): boolean {
  return output
    .split(/\r?\n/)
    .some((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
      try {
        JSON.parse(trimmed);
        return true;
      } catch {
        return false;
      }
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProbe().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
