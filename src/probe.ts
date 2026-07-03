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

  for (const adapter of allAdapters()) {
    const runnerRoot = path.join(root, adapter.type);
    await mkdir(runnerRoot, { recursive: true });
    const probe = await adapter.probe(projectRoot);

    if (probe.available) {
      const promptCommand = adapter.promptCommand("请只回复：agentroom-probe-ok");
      const prompt = await runCapture(promptCommand, projectRoot, 30_000);
      probe.promptExitCode = prompt.exitCode;
      probe.stdout = prompt.stdout;
      probe.stderr = [probe.stderr, prompt.stderr].filter(Boolean).join("\n");
      probe.supportsStreaming = prompt.stdout.includes("\n");
      probe.supportsStructuredOutput = looksStructured(prompt.stdout);
      await writeFile(path.join(runnerRoot, "prompt.stdout.log"), prompt.stdout, "utf8");
      await writeFile(path.join(runnerRoot, "prompt.stderr.log"), prompt.stderr, "utf8");
    }

    await writeJson(path.join(runnerRoot, "probe-result.json"), probe);
    summaries.push(`${adapter.displayName}：${probe.available ? "可用" : "不可用"}${probe.version ? `（${probe.version.split(/\r?\n/)[0]}）` : ""}`);
  }

  console.log(`探测结果已写入：${root}`);
  console.log(summaries.join("\n"));
  return { root, summaries };
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
