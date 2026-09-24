#!/usr/bin/env node
/**
 * Apply the repo's `patches/*.patch` files to installed dependencies.
 *
 * pnpm pins its `@earendil-works/pi-ai` fixes through `patchedDependencies`,
 * which rewrites the package inside pnpm's content store at install time.
 * This project deliberately uses npm (see the project decision to stay on
 * npm), and npm has no equivalent hook: a `patches/*.patch` file sitting in
 * the repository does nothing on its own.
 *
 * The patches are load-bearing, not cosmetic. The pi-ai patch adds the
 * 429/`Retry-After` retry ladder to the Anthropic OAuth token exchange; with
 * it unapplied, a rate-limited refresh throws instead of waiting, which is
 * exactly what `tests/anthropic-oauth-retry.test.mjs` asserts against.
 *
 * So this script replays them after every install. It is idempotent: an
 * already-applied patch is detected and skipped, and `git apply --check`
 * runs first so a patch that no longer fits the installed version fails
 * loudly here rather than silently drifting.
 *
 * Usage: node scripts/apply-patches.mjs [--check]
 *   --check  verify the patches apply without modifying anything
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const patchesDir = join(repoRoot, "patches");
const checkOnly = process.argv.includes("--check");

/**
 * `@scope__name@version.patch` -> the directory the patch must be applied
 * from. The patch bodies carry `a/dist/...` paths, so the cwd is the package
 * root and `-p1` strips the leading `a/`.
 */
function targetFor(patchName) {
  const match = /^(.*)@(\d[^@]*)\.patch$/.exec(patchName);
  if (match === null) return null;
  const [, packageName, version] = match;
  const [scope, name] = packageName.includes("__")
    ? packageName.split("__")
    : [null, packageName];
  const installed = scope
    ? join(repoRoot, "node_modules", scope, name)
    : join(repoRoot, "node_modules", name);
  return { installed, version, packageName };
}

function gitApply(args, cwd) {
  return execFileSync("git", ["apply", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** `git apply` refuses paths inside an ignored tree; lift the ceiling. */
function withCeiling(ceiling, run) {
  const previous = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = ceiling;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = previous;
  }
}

if (!existsSync(patchesDir)) {
  console.log("no patches/ directory — nothing to apply");
  process.exit(0);
}

const patches = readdirSync(patchesDir).filter((name) => name.endsWith(".patch"));
if (patches.length === 0) {
  console.log("no *.patch files — nothing to apply");
  process.exit(0);
}

let failures = 0;

for (const patch of patches) {
  const target = targetFor(patch);
  const patchPath = join(patchesDir, patch);

  if (target === null || !existsSync(target.installed)) {
    console.log(`SKIP  ${patch} — ${target?.packageName ?? "unparsable"} is not installed`);
    continue;
  }

  const { installed } = target;
  // node_modules lives under an ignored path, so git needs the ceiling lifted
  // for both the probe and the real application.
  const run = (args) =>
    withCeiling(join(repoRoot, "node_modules"), () => gitApply(args, installed));

  try {
    run(["-p1", "--check", patchPath]);
  } catch {
    // The patch does not apply. Either it is already applied (the common case
    // on a re-run) or the installed version moved under us. Distinguish them
    // by asking whether the reverse patch applies cleanly.
    try {
      run(["-p1", "--check", "--reverse", patchPath]);
      console.log(`OK    ${patch} — already applied`);
      continue;
    } catch {
      console.error(`FAIL  ${patch} — does not apply and is not already applied`);
      failures += 1;
      continue;
    }
  }

  if (checkOnly) {
    console.log(`OK    ${patch} — applies cleanly (--check)`);
    continue;
  }
  run(["-p1", patchPath]);
  console.log(`OK    ${patch} — applied`);
}

if (failures > 0) {
  console.error(`\n${failures} patch(es) could not be applied.`);
  process.exit(1);
}
