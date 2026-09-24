/**
 * Every text file in the tree has to be valid UTF-8.
 *
 * Three files carried invalid UTF-8 from the commit that introduced them
 * (`c0f2bec`, "port the settings, plugin and extension surfaces") and nothing
 * noticed for the whole life of the tree. The damage is a GBK round trip: each
 * three-byte character lost its third byte, which was replaced by `0x3F`
 * ("?"), and the byte that *followed* the sequence was consumed whenever it
 * fell below `0x40` — a space after an arrow, the newline after an em dash.
 *
 *   `Settings → Import`      became `Settings \xE2\x86?Import`
 *   `by source —\n * unlike` became `by source \xE2\x80? * unlike`
 *
 * Why it is worth a gate rather than a one-off fix:
 *
 *  - Every tool in this repo reads these files as UTF-8 and silently substitutes
 *    U+FFFD for the bad bytes, so the corruption is invisible in review and in
 *    `git diff` — the diff shows a replacement character, not the bytes.
 *  - The Edit tool *re-encodes* invalid input to U+FFFD, so touching such a file
 *    for an unrelated reason silently rewrites its damaged bytes and mixes an
 *    unintended change into the diff (this happened twice in this tree).
 *  - Node, TypeScript, Vite and `vue-tsc` all accept the bytes, so no build or
 *    type gate can catch it.
 *
 * The guard reads raw bytes and round-trips them, which is the only reliable
 * test: `Buffer.from(text, "utf8")` is lossless for well-formed input and
 * lossy exactly when it is not. The second case is a positive control — it
 * runs the same check over a deliberately damaged buffer, because a guard that
 * silently stops matching passes forever.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { rendererRoot } from "./helpers/class-contract.mjs";

/** `<root>/src/renderer/` -> `<root>`. */
const repoRoot = dirname(dirname(rendererRoot));

/**
 * Directories that hold generated output, dependencies or the repository
 * itself. `out` and `dist` are build products; `target` is Rust.
 */
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "out",
  "dist",
  "target",
  ".vite",
]);

/** Extensions the project owns as text. */
const TEXT_FILE = /\.(ts|tsx|vue|mjs|cjs|js|jsx|json|jsonc|css|scss|md|txt|yml|yaml|html|rs|toml)$/;

/** Every owned text file under `dir`, repo-relative with forward slashes. */
function textFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...textFiles(full));
    else if (TEXT_FILE.test(entry.name)) found.push(full);
  }
  return found;
}

/**
 * The first byte offset where the file is not valid UTF-8, or `null`.
 *
 * The round trip is the test: for well-formed input re-encoding the decoded
 * string reproduces the bytes exactly, and for malformed input it does not.
 */
function invalidUtf8Offset(bytes) {
  const round = Buffer.from(bytes.toString("utf8"), "utf8");
  if (bytes.equals(round)) return null;
  let offset = 0;
  while (bytes[offset] === round[offset]) offset += 1;
  return offset;
}

test("no owned text file carries invalid UTF-8", () => {
  const files = textFiles(repoRoot);
  // Guard the guard: a broken walker would make the assertion below vacuous.
  assert.ok(files.length > 800, `expected a broad scan, walked ${files.length}`);

  const damaged = [];
  for (const file of files) {
    const offset = invalidUtf8Offset(readFileSync(file));
    if (offset === null) continue;
    const bytes = readFileSync(file);
    damaged.push(
      `${file.slice(repoRoot.length + 1).split("\\").join("/")} @${offset} ` +
        `(${bytes.subarray(offset, offset + 3).toString("hex")})`,
    );
  }
  assert.deepEqual(
    damaged,
    [],
    `these files are not valid UTF-8, so every reader silently replaces the ` +
      `bad bytes with U+FFFD and the Edit tool would rewrite them:\n  ${damaged.join("\n  ")}`,
  );
});

test("the check reports a deliberately damaged buffer", () => {
  const clean = Buffer.from("Groups are always by source \u2014 and each row", "utf8");
  assert.equal(invalidUtf8Offset(clean), null);

  // The exact shape the three files had: the em dash lost its third byte and
  // the space that followed it was consumed.
  const damaged = Buffer.from([
    ...Buffer.from("Groups are always by source ", "utf8"),
    0xe2,
    0x80,
    0x3f,
    ...Buffer.from("and each row", "utf8"),
  ]);
  assert.equal(invalidUtf8Offset(damaged), 28);

  // A truncated arrow, the other shape that was present.
  const arrow = Buffer.from([
    ...Buffer.from("(Settings ", "utf8"),
    0xe2,
    0x86,
    0x3f,
    ...Buffer.from("Import)", "utf8"),
  ]);
  assert.equal(invalidUtf8Offset(arrow), 10);
});
