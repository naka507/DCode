import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const globalStyles = await loadStyles();

test("workspace context rail styles are removed", () => {
  assert.doesNotMatch(globalStyles, /\.composer-chips\b/);
  assert.doesNotMatch(globalStyles, /\.chip-sep\b/);
  assert.doesNotMatch(globalStyles, /\.chip-label\b/);
});
