/**
 * Shared thinking-level selectors, including the `omit` session level.
 *
 * Mirrors the vitest cases in `tests/shared/thinking-levels.test.ts` added in
 * `3e6ddb39` ("session thinking omit") and `605d9fa7` ("offers omit as a
 * Settings default on a reasoning binding"), which run under
 * `npm run test:unit`; this is the `node:test` copy, kept in step with the
 * `.test.ts` source.
 *
 * `expect(x).toBe(y)` -> `assert.equal(x, y)`; `toEqual` -> `assert.deepEqual`.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const {
  bindingDefaultThinkingMenuLevels,
  canonicalThinkingLevel,
  initialThinkingLevelForBinding,
  isSessionThinkingLevel,
  resolveBindingDefaultThinkingLevel,
  sessionThinkingMenuLevels,
} = await import("../src/shared/thinking-levels.ts");

test("accepts omit as a session selector without treating it as a capability", () => {
  assert.equal(isSessionThinkingLevel("omit"), true);
  assert.equal(isSessionThinkingLevel("high"), true);
  assert.equal(isSessionThinkingLevel("turbo"), false);
  assert.deepEqual(sessionThinkingMenuLevels(["low", "high"]), ["omit", "low", "high"]);
  assert.deepEqual(sessionThinkingMenuLevels([]), ["off"]);
  assert.equal(canonicalThinkingLevel("omit"), "off");
  assert.equal(canonicalThinkingLevel("high"), "high");
});

test("offers omit as a Settings default on a reasoning binding", () => {
  assert.deepEqual(bindingDefaultThinkingMenuLevels(["low", "high"]), ["omit", "low", "high"]);
  assert.deepEqual(bindingDefaultThinkingMenuLevels(["high"]), ["omit", "high"]);
  assert.deepEqual(bindingDefaultThinkingMenuLevels(["off"]), ["off"]);
  assert.deepEqual(bindingDefaultThinkingMenuLevels([]), ["off"]);
  assert.equal(resolveBindingDefaultThinkingLevel("omit", ["low", "high"]), "omit");
  assert.equal(resolveBindingDefaultThinkingLevel("omit", ["off"]), "off");
  assert.equal(resolveBindingDefaultThinkingLevel(null, ["low", "high"]), "low");
  assert.equal(
    initialThinkingLevelForBinding({
      thinkingLevels: ["low", "high"],
      defaultThinkingLevel: "omit",
    }),
    "omit",
  );
  assert.equal(
    initialThinkingLevelForBinding({
      thinkingLevels: ["off"],
      defaultThinkingLevel: "omit",
    }),
    "off",
  );
});
