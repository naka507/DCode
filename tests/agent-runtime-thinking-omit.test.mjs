/**
 * The runtime half of the `omit` thinking level.
 *
 * Covers the case also kept in `tests/agent-runtime/runtime.test.ts` under
 * `npm run test:unit` ("omits the provider thinking override when the session
 * level is omit", `3e6ddb39`); this is the `node:test` copy.
 *
 * Assertion translation, keeping every assertion:
 *   `expect(x).toBe(y)`       -> `assert.equal(x, y)`
 *   `expect(x).toHaveLength(n)` -> `assert.equal(x.length, n)`
 *   `expect(x).toBeUndefined()` -> `assert.equal(x, undefined)`
 *
 * The case drives `agent.streamFunction` directly with a stubbed
 * `fetch` and reads the JSON body the Responses adapter built. That harness is
 * available here (the runtime builds a real pi-ai agent), so the case is
 * reproduced rather than weakened: the same request is issued once, and the
 * `omit` path must leave `reasoning` off the wire while `high` keeps it, which
 * is what proves the low-level stream — not a synthesized `off` mapping — is
 * what runs.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { DesktopAgentRuntime } = await import("../src/agent/runtime/runtime.ts");

const provider = {
  id: "responses",
  name: "Responses",
  apiStyle: "responses",
  baseUrl: "https://example.invalid/v1",
  modelId: "responses-model",
  apiKey: "test-key",
  authKind: "none",
  supportsReasoning: true,
  supportedThinkingLevels: ["off", "high"],
  modelConfig: {
    source: "generic",
    name: "Responses model",
    baseUrl: "https://example.invalid/v1",
    reasoning: true,
    thinkingLevelMap: { off: "none", high: "high" },
    input: ["text"],
    contextWindow: 128000,
    maxTokens: 8192,
  },
};

const commandShell = {
  id: "bash",
  label: "Bash",
  dialect: "posix",
  available: true,
  isDefault: true,
};

/** Run one model request through the runtime's own stream function. */
async function requestFor(thinkingLevel) {
  const runtime = new DesktopAgentRuntime({
    host: { call: async () => ({}), onNotification: () => () => {} },
    sessionId: "session-1",
    mode: "agent",
    provider,
    commandShell,
    thinkingLevel,
    onEvent: () => {},
  });
  const agent = runtime.agent;
  const requests = [];
  const fetch = async (_input, init) => {
    requests.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}"));
    return new Response("bad request", { status: 400 });
  };
  const stream = agent.streamFunction(
    agent.state.model,
    { systemPrompt: "system", messages: [], tools: [] },
    { fetch },
  );
  await stream.result().catch(() => {});
  await runtime.dispose();
  return { runtime, agent, requests };
}

test("omits the provider thinking override when the session level is omit", async () => {
  const { runtime, agent, requests } = await requestFor("omit");
  assert.equal(agent.state.thinkingLevel, "off");
  assert.equal(runtime.thinkingLevel, "omit");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].reasoning, undefined);
});

test("a canonical level still reaches the provider as a reasoning override", async () => {
  const { requests } = await requestFor("high");
  assert.equal(requests.length, 1);
  assert.notEqual(requests[0].reasoning, undefined);
});
