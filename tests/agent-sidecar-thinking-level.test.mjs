/**
 * Sidecar thinking-level boundary, including the `omit` session level.
 *
 * The same case lives at `tests/agent-runtime/sidecar-config.test.ts` under
 * `npm run test:unit` (`expect(normalizeThinkingLevel("omit")).toBe("omit")`);
 * this is the `node:test` copy.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { normalizeSupportedThinkingLevels, normalizeThinkingLevel } = await import(
  "../src/agent/runtime/sidecar-config.ts"
);

test("preserves supported levels from IPC params", () => {
  assert.equal(normalizeThinkingLevel("high"), "high");
  assert.equal(normalizeThinkingLevel("off"), "off");
  assert.equal(normalizeThinkingLevel("omit"), "omit");
});

test("fails closed to off for malformed or absent params", () => {
  assert.equal(normalizeThinkingLevel(undefined), "off");
  assert.equal(normalizeThinkingLevel("invalid"), "off");
  assert.equal(normalizeThinkingLevel(3), "off");
});

test("normalizes provider capability metadata at the sidecar boundary", () => {
  assert.deepEqual(normalizeSupportedThinkingLevels(undefined, true), [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(normalizeSupportedThinkingLevels(["high", "high", "invalid"], true), [
    "high",
  ]);
  assert.deepEqual(normalizeSupportedThinkingLevels(["high"], false), ["off"]);
});
