/**
 * The runtime half of provider-hosted web search.
 *
 * Covers the two cases also kept in `tests/agent-runtime/runtime.test.ts`,
 * which `npm run test:unit` runs: "emits each search round as it happens and
 * closes open rounds on message_end" (`2e763893`) and "replays persisted
 * hostedSearch blocks into model context on restore" (`003bc0ae`). They are
 * mirrored here as well so `npm test` covers them too.
 *
 * Two behaviours are load-bearing and neither is visible anywhere else:
 *
 *  1. `applyHostedSearch` re-emits the assistant bubble as a full
 *     `message_update` the moment a round appears, so a search row renders while
 *     the turn is still running instead of only at `message_end`.
 *  2. `historyToEntries` pushes `hostedSearch.replay` back into the assistant
 *     content before the text block, which is what lets `convertMessages` ground
 *     a later turn on a search that happened before a restart.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { DesktopAgentRuntime } = await import("../src/agent/runtime/runtime.ts");

const provider = {
  id: "provider",
  modelId: "model",
  apiStyle: "responses",
  baseUrl: "http://localhost/v1",
  api: "openai-responses",
};

const commandShell = {
  id: "bash",
  label: "Bash",
  dialect: "posix",
  available: true,
  isDefault: true,
};

function createRuntime(overrides = {}) {
  const events = [];
  const runtime = new DesktopAgentRuntime({
    host: { call: async () => ({}), onNotification: () => () => {} },
    sessionId: "session-1",
    mode: "agent",
    provider,
    commandShell,
    thinkingLevel: "medium",
    onEvent: (envelope) => events.push(envelope),
    ...overrides,
  });
  return { runtime, events };
}

/** Minimal pi-ai assistant message; `overrides` carries the shape under test. */
function assistantMessage(overrides) {
  return {
    role: "assistant",
    api: "openai-completions",
    provider: "local",
    model: "local-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: overrides.stopReason ?? "stop",
    timestamp: 2,
    content: overrides.content,
  };
}

/** One adapter-captured responses `web_search_call` block. */
function round(id, status, query, sources = []) {
  return {
    type: "hostedSearch",
    phase: "web_search_call",
    blockId: id,
    status,
    wire: {
      type: "web_search_call",
      id,
      status,
      action: { type: "search", query, ...(sources.length ? { sources } : {}) },
    },
  };
}

/** The runtime wraps each agent event in an envelope; the vitest source unwraps it too. */
function unwrapped(events) {
  return events.map((envelope) => envelope.event);
}

test("emits each search round as it happens and closes open rounds on message_end", async () => {
  const { runtime, events } = createRuntime();
  const handleAgentEvent = runtime.handleAgentEvent.bind(runtime);

  await handleAgentEvent({ type: "agent_start" });
  await handleAgentEvent({ type: "turn_start" });
  // Round 1 starts searching.
  await handleAgentEvent({
    type: "message_start",
    message: { role: "assistant", content: [round("ws_1", "in_progress", "first query")] },
  });
  // Round 1 completes and round 2 starts, still without any text.
  await handleAgentEvent({
    type: "message_update",
    message: {
      role: "assistant",
      content: [
        round("ws_1", "completed", "first query", [
          { url: "https://example.com/a", title: "A" },
        ]),
        round("ws_2", "in_progress", "second query"),
      ],
    },
  });
  // The turn ends while round 2 is still open; text arrived meanwhile.
  await handleAgentEvent({
    type: "message_end",
    message: assistantMessage({
      content: [
        round("ws_1", "completed", "first query", [
          { url: "https://example.com/a", title: "A" },
        ]),
        round("ws_2", "in_progress", "second query"),
        { type: "text", text: "The answer." },
      ],
    }),
  });
  await handleAgentEvent({ type: "turn_end" });
  await handleAgentEvent({ type: "agent_end", messages: [] });

  const agentEvents = unwrapped(events);
  const searchUpdates = agentEvents.filter(
    (event) => event.type === "message_update" && event.message?.hostedSearch,
  );
  assert.ok(
    searchUpdates.length >= 2,
    `each round must stream as it happens, saw ${searchUpdates.length} search updates`,
  );
  // Round 1 streamed the moment it started; round 2 the moment it appeared.
  assert.deepEqual(
    searchUpdates[0]?.message?.hostedSearch?.rounds,
    [{ id: "ws_1", status: "searching", query: "first query", sources: [] }],
  );
  assert.deepEqual(
    searchUpdates.at(-1)?.message?.hostedSearch?.rounds,
    [
      {
        id: "ws_1",
        status: "completed",
        query: "first query",
        sources: [{ url: "https://example.com/a", title: "A" }],
      },
      { id: "ws_2", status: "searching", query: "second query", sources: [] },
    ],
  );
  const end = agentEvents.find((event) => event.type === "message_end");
  // A round still open when the turn ends closes as completed, not left
  // blinking "searching" in a settled transcript.
  assert.deepEqual(end?.message?.hostedSearch, {
    status: "completed",
    rounds: [
      {
        id: "ws_1",
        status: "completed",
        query: "first query",
        sources: [{ url: "https://example.com/a", title: "A" }],
      },
      { id: "ws_2", status: "completed", query: "second query", sources: [] },
    ],
    replay: [
      round("ws_1", "completed", "first query", [
        { url: "https://example.com/a", title: "A" },
      ]),
      round("ws_2", "in_progress", "second query"),
    ],
  });
  await runtime.dispose();
});

test("replays persisted hostedSearch blocks into model context on restore", async () => {
  const { runtime: restored } = createRuntime({
    history: [
      {
        id: "u1",
        role: "user",
        content: "news?",
        status: "complete",
        createdAt: "2026-09-19T00:00:00.000Z",
      },
      {
        id: "a1",
        role: "assistant",
        content: "here is the news",
        status: "complete",
        createdAt: "2026-09-19T00:00:01.000Z",
        hostedSearch: {
          status: "completed",
          rounds: [{ id: "srvtoolu_01", status: "completed", query: "news", sources: [] }],
          replay: [
            {
              type: "hostedSearch",
              phase: "server_tool_use",
              blockId: "srvtoolu_01",
              name: "web_search",
              input: { query: "news" },
            },
            {
              type: "hostedSearch",
              phase: "web_search_tool_result",
              blockId: "srvtoolu_01",
              wire: {
                type: "web_search_tool_result",
                encrypted_content: "enc-1",
              },
            },
          ],
        },
      },
    ],
  });

  const assistant = restored.agent.state.messages.find(
    (message) => message.role === "assistant",
  );
  assert.deepEqual(assistant?.content, [
    {
      type: "hostedSearch",
      phase: "server_tool_use",
      blockId: "srvtoolu_01",
      name: "web_search",
      input: { query: "news" },
    },
    {
      type: "hostedSearch",
      phase: "web_search_tool_result",
      blockId: "srvtoolu_01",
      wire: { type: "web_search_tool_result", encrypted_content: "enc-1" },
    },
    { type: "text", text: "here is the news" },
  ]);
  await restored.dispose();
});

test("a message without replay restores without hostedSearch content", async () => {
  // The `replay` field is absent on transcripts written before it existed.
  // Those rows must still restore, just without grounding blocks.
  const { runtime } = createRuntime({
    history: [
      {
        id: "a1",
        role: "assistant",
        content: "old answer",
        status: "complete",
        createdAt: "2026-09-19T00:00:01.000Z",
        hostedSearch: {
          status: "completed",
          rounds: [{ id: "legacy", status: "completed", query: "old", sources: [] }],
        },
      },
    ],
  });
  const assistant = runtime.agent.state.messages.find(
    (message) => message.role === "assistant",
  );
  assert.deepEqual(assistant?.content, [{ type: "text", text: "old answer" }]);
  await runtime.dispose();
});
