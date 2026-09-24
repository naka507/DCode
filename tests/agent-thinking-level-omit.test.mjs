/**
 * Agent-runtime thinking-level helpers, including the `omit` session level.
 *
 * Covers `tests/agent-runtime/thinking-level.test.ts`, which runs under
 * `npm run test:unit`; this is the `node:test` copy.
 *
 * `expect(x).toBe(y)` -> `assert.equal(x, y)`; `toEqual` -> `assert.deepEqual`.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { agentThinkingLevel, clampThinkingLevel, omitThinkingModel } = await import(
  "../src/agent/runtime/thinking-level.ts"
);

const reasoning = {
  supportsReasoning: true,
  supportedThinkingLevels: ["off", "low", "high"],
};

test("keeps omit on a reasoning model and maps bookkeeping to off", () => {
  assert.equal(clampThinkingLevel(reasoning, "omit"), "omit");
  assert.equal(agentThinkingLevel("omit"), "off");
  assert.equal(agentThinkingLevel("high"), "high");
});

test("forces omit to off when the model cannot reason", () => {
  assert.equal(
    clampThinkingLevel(
      { supportsReasoning: false, supportedThinkingLevels: ["off"] },
      "omit",
    ),
    "off",
  );
});

test("nulls the off mapping so adapters send no thinking field", () => {
  assert.deepEqual(
    omitThinkingModel({ thinkingLevelMap: { off: "none", high: "high" } })
      .thinkingLevelMap,
    { off: null, high: "high" },
  );
});
