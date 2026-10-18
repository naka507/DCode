#!/usr/bin/env node
/**
 * ADR-005 eval runner.
 *
 * Usage:
 *   node scripts/run-evals.mjs [--task <id>] [--dcore <path>]
 *
 * Provider config: evals/provider.json (gitignored) or the
 * DCODE_EVAL_PROVIDER_JSON env var, as a RuntimeProviderConfig JSON object.
 * DCore binary: --dcore flag, DCODE_EVAL_DCORE env, or ./target/debug/dcore
 * relative to the DCore checkout (override as needed).
 */
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const args = process.argv.slice(2);
  const taskFilter = args.includes("--task") ? args[args.indexOf("--task") + 1] : undefined;

  // Provider: env or evals/provider.json.
  let providerJson = process.env.DCODE_EVAL_PROVIDER_JSON;
  const providerPath = join(root, "evals", "provider.json");
  if (!providerJson && existsSync(providerPath)) {
    providerJson = await readFile(providerPath, "utf8");
  }
  if (!providerJson) {
    console.error(
      "No provider configured. Put a RuntimeProviderConfig JSON object in evals/provider.json (gitignored) or set DCODE_EVAL_PROVIDER_JSON.",
    );
    process.exit(2);
  }
  const provider = JSON.parse(providerJson);

  // DCore binary.
  const dcoreIdx = args.indexOf("--dcore");
  const dcoreBinaryPath =
    (dcoreIdx !== -1 ? args[dcoreIdx + 1] : undefined) ??
    process.env.DCODE_EVAL_DCORE ??
    join(process.env.HOME ?? "", "workspace", "repos", "DCore", "target", "debug", "dcore");
  if (!existsSync(dcoreBinaryPath)) {
    console.error(`DCore binary not found at ${dcoreBinaryPath}. Build it (cargo build in the DCore repo) or pass --dcore <path>.`);
    process.exit(2);
  }

  // The eval modules are TypeScript; Node 22+ strips types natively.
  // Run this script with: node --experimental-strip-types scripts/run-evals.mjs
  const { runEvalTask } = await import(
    pathToFileURL(join(root, "src", "eval", "runner.ts")).href
  );
  const { printReport } = await import(
    pathToFileURL(join(root, "src", "eval", "report.ts")).href
  );

  const tasksDir = join(root, "evals", "tasks");
  const entries = await readdir(tasksDir, { withFileTypes: true });
  const taskIds = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((id) => !taskFilter || id === taskFilter)
    .sort();
  if (taskIds.length === 0) {
    console.error(`No tasks found${taskFilter ? ` matching "${taskFilter}"` : ""}.`);
    process.exit(2);
  }

  const commandShell = {
    id: "bash",
    label: "Bash",
    dialect: "posix",
    available: true,
    isDefault: true,
  };

  const results = [];
  for (const id of taskIds) {
    console.log(`\nRunning eval task: ${id}`);
    const mod = await import(
      pathToFileURL(join(tasksDir, id, "task.ts")).href
    );
    const result = await runEvalTask({
      task: mod.task,
      provider,
      commandShell,
      dcoreBinaryPath,
    });
    results.push(result);
  }

  printReport(results);
  process.exit(results.every((r) => r.passed) ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
