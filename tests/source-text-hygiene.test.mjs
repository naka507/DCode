/**
 * Source files must stay text. A raw NUL byte (for example one typed into a
 * template literal as a key separator) makes grep, ripgrep and the agent's own
 * Grep tool classify the whole file as binary and skip it, so the file
 * silently drops out of every search. Write the escape `\u0000` instead.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const ROOTS = ["src", "scripts", "tests"];
const TEXT_EXTENSIONS = new Set([".ts", ".mts", ".js", ".mjs", ".cjs", ".vue", ".css", ".json", ".md"]);

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (TEXT_EXTENSIONS.has(extname(entry.name))) yield path;
  }
}

test("source files contain no raw NUL bytes", () => {
  const offenders = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(join(repoRoot, root))) {
      if (readFileSync(file).includes(0)) offenders.push(relative(repoRoot, file));
    }
  }
  assert.deepEqual(offenders, [], "write \\u0000 instead of a raw NUL byte");
});
