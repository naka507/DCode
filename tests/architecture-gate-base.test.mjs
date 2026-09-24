import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The architecture gate's added-file base.
 *
 * `scripts/check-architecture.mjs` enforces an 800-LOC ceiling on *new*
 * TypeScript files, which means it needs a revision to diff against. The
 * gate once hardcoded `main`; this tree's default branch is `master`
 * (AGENTS.md § 5), so the name resolved nowhere and the gate fell back to
 * `HEAD^`.
 *
 * That fallback is the defect these cases pin: `HEAD^` is one commit deep, so a
 * new over-limit file added *earlier* on the branch was never diffed and passed
 * the ceiling unnoticed. Every run still printed `Architecture check passed`,
 * and the only trace was a warning line on stderr.
 *
 * Each case builds a throwaway repository because the gate reads
 * `process.cwd()`. The gate is executed as a real child process, so these
 * assertions cover the shipped entry point rather than a re-implementation.
 */

const GATE = fileURLToPath(new URL("../scripts/check-architecture.mjs", import.meta.url));

const BASELINE_FILES = [
  "src/main/index.ts",
  "src/renderer/stores/app-store.ts",
];

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Run the gate in `cwd` and report its exit status with all its output.
 *
 * A non-zero exit is the gate reporting a violation, which is the outcome some
 * cases assert, so it is returned rather than thrown.
 */
function runGate(cwd) {
  try {
    const stdout = execFileSync(process.execPath, [GATE], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    return {
      status: error.status ?? 1,
      output: String(error.stdout || "") + String(error.stderr || ""),
    };
  }
}

/**
 * A repository whose default branch is `name`, with one baseline commit that
 * already carries the two files the gate requires to exist.
 */
function initRepo(name) {
  const dir = mkdtempSync(join(tmpdir(), "dcode-arch-gate-"));
  git(dir, ["init"]);
  // `git init` respects `init.defaultbranch`, so name the branch explicitly
  // rather than depending on the machine's configuration.
  git(dir, ["symbolic-ref", "HEAD", `refs/heads/${name}`]);
  git(dir, ["config", "user.email", "gate-test@example.com"]);
  git(dir, ["config", "user.name", "gate test"]);
  for (const path of BASELINE_FILES) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), "export const baseline = true;\n");
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "baseline"]);
  return dir;
}

function commit(cwd, message, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(cwd, path, ".."), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-m", message]);
}

/** A source file just past the gate's 800-LOC new-file ceiling. */
const OVER_LIMIT = "export const filler = 1;\n".repeat(900);

test("a new over-limit file on an earlier commit of the branch is still caught", (t) => {
  const dir = initRepo("master");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // The default branch stays at the baseline; the task branch grows past it.
  git(dir, ["checkout", "-b", "feat/task"]);
  // The over-limit file lands first, and a second commit follows it. A base of
  // `HEAD^` would diff only the second commit and miss this file entirely.
  commit(dir, "add an over-limit module", { "src/renderer/lib/too-big.ts": OVER_LIMIT });
  commit(dir, "add a follow-up module", { "src/renderer/lib/small.ts": "export const small = 1;\n" });

  const { status, output } = runGate(dir);

  assert.equal(status, 1, "the gate must fail on the added over-limit file");
  assert.match(output, /too-big\.ts \(\d+ LOC\) is a new TypeScript source file over 800 LOC/);
  assert.doesNotMatch(output, /Architecture check passed/);
});

test("the added-file base is the default branch, not the previous commit", (t) => {
  const dir = initRepo("master");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, ["checkout", "-b", "feat/task"]);
  commit(dir, "add an over-limit module", { "src/renderer/lib/too-big.ts": OVER_LIMIT });
  commit(dir, "add a follow-up module", { "src/renderer/lib/small.ts": "export const small = 1;\n" });

  const { output } = runGate(dir);

  // Both commits count as added against the default branch, which is the whole
  // point: `HEAD^` would report 1 here.
  assert.match(output, /New TS\/TSX files checked: 2/);
  assert.doesNotMatch(output, /Architecture base .* is unavailable/);
});

test("a repository whose default branch is main is diffed the same way", (t) => {
  const dir = initRepo("main");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, ["checkout", "-b", "feat/task"]);
  commit(dir, "add an over-limit module", { "src/renderer/lib/too-big.ts": OVER_LIMIT });
  commit(dir, "add a follow-up module", { "src/renderer/lib/small.ts": "export const small = 1;\n" });

  const { status, output } = runGate(dir);

  assert.equal(status, 1);
  assert.match(output, /too-big\.ts \(\d+ LOC\) is a new TypeScript source file over 800 LOC/);
});

test("an explicit --base still wins over the inferred default branch", (t) => {
  const dir = initRepo("master");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, ["checkout", "-b", "feat/task"]);
  commit(dir, "add an over-limit module", { "src/renderer/lib/too-big.ts": OVER_LIMIT });
  const tip = git(dir, ["rev-parse", "HEAD"]).trim();
  commit(dir, "add a follow-up module", { "src/renderer/lib/small.ts": "export const small = 1;\n" });

  // Pinning the base to the commit that added the file leaves only the
  // follow-up in the diff, so the gate passes — the caller's base is honoured.
  const stdout = execFileSync(process.execPath, [GATE, "--base", tip], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.match(stdout, /New TS\/TSX files checked: 1/);
  assert.match(stdout, /Architecture check passed/);
});

test("a branch that adds nothing over the limit still passes", (t) => {
  const dir = initRepo("master");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, ["checkout", "-b", "feat/task"]);
  commit(dir, "add a small module", { "src/renderer/lib/small.ts": "export const small = 1;\n" });

  const { status, output } = runGate(dir);

  assert.equal(status, 0);
  assert.match(output, /Architecture check passed/);
  assert.match(output, /New TS\/TSX files checked: 1/);
});

test("a file deleted in the working tree does not crash the gate", (t) => {
  const dir = initRepo("master");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, ["checkout", "-b", "feat/task"]);
  commit(dir, "add a module", { "src/renderer/lib/small.ts": "export const small = 1;\n" });

  // `git ls-files -c` still lists an index entry whose working-tree file is
  // gone, and reading it used to die on ENOENT instead of reporting a verdict.
  rmSync(join(dir, "src/renderer/lib/small.ts"));

  const { status, output } = runGate(dir);

  assert.equal(status, 0, "a deletion is not an architecture violation");
  assert.match(output, /Architecture check passed/);
  assert.doesNotMatch(output, /ENOENT/);
});
