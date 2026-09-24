/**
 * Contract tests for the pi-ai / pi-agent-core hosted web search patches.
 *
 * `patches/@earendil-works__pi-ai@0.85.1.patch` teaches the anthropic-messages
 * and openai-responses adapters to attach the provider hosted web search tool
 * when the model record opts in (`model.webSearch === true`), to extract the
 * search blocks and citations from the stream, and to replay the search items
 * on later turns. `patches/@earendil-works__pi-agent-core@0.85.1.patch` forwards
 * the adapter's new `hosted_search_update` event through the agent loop so each
 * round renders while the turn is still running.
 *
 * Nothing else in this repository guards either patch: `npm run patches:check`
 * only proves the hunk applies to the installed version, and the patches live
 * under `node_modules/`, so a silently dropped or half-applied hunk is invisible
 * to every other suite. These cases drive the exported stream processor and
 * message converter with synthetic provider events instead of a real provider.
 *
 * The responses half also lives in
 * `tests/agent-runtime/hosted-search-contract.test.ts` and runs under
 * `npm run test:unit`. These cases are the `node:test` copy, so `npm test`
 * executes them too.
 *
 * The one deliberate addition is the anthropic-wire half: the `.test.ts` copy
 * exercises only `openai-responses-shared`, so a regression in the
 * `anthropic-messages` hunks of the same patch would pass there. Both wires
 * are covered here.
 */
import assert from "node:assert/strict";
import test from "node:test";

/** A minimal assistant message the responses processor can mutate. */
function responsesOutput() {
  return {
    role: "assistant",
    content: [],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

const responsesModel = {
  id: "gpt-test",
  api: "openai-responses",
  provider: "openai",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8_192,
};

async function processEvents(events) {
  const { processResponsesStream } = await import(
    "@earendil-works/pi-ai/api/openai-responses-shared"
  );
  const output = responsesOutput();
  const stream = [];
  const sink = { push: (event) => stream.push(event) };
  const asyncEvents = (async function* () {
    for (const event of events) yield event;
  })();
  await processResponsesStream(asyncEvents, output, sink, responsesModel, {});
  return { output, stream };
}

function hostedSearchBlocks(output) {
  return output.content.filter((block) => (block ?? {}).type === "hostedSearch");
}

test("pi-ai patch: a responses web_search_call becomes a hostedSearch content block", async () => {
  const { output } = await processEvents([
    { type: "response.created", response: { id: "resp_1" } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: "web_search_call",
        id: "ws_1",
        status: "in_progress",
        action: { type: "search", query: "dcode release notes" },
      },
    },
    {
      type: "response.output_item.added",
      output_index: 1,
      item: { type: "message", id: "msg_1", role: "assistant" },
    },
    {
      type: "response.output_text.delta",
      output_index: 1,
      delta: "Found it.",
    },
    {
      type: "response.output_text.annotation.added",
      output_index: 1,
      annotation: {
        type: "url_citation",
        url: "https://example.com/release",
        title: "Release notes",
        start_index: 0,
        end_index: 5,
      },
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "web_search_call",
        id: "ws_1",
        status: "completed",
        action: { type: "search", query: "dcode release notes" },
      },
    },
    {
      type: "response.output_item.done",
      output_index: 1,
      item: {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Found it.", annotations: [] }],
      },
    },
    { type: "response.completed", response: { id: "resp_1", usage: {} } },
  ]);

  const search = output.content.find((block) => (block ?? {}).type === "hostedSearch");
  assert.ok(search, "the web_search_call item must survive as a hostedSearch block");
  assert.equal(search.phase, "web_search_call");
  assert.equal(search.status, "completed");
  assert.deepEqual(
    { type: search.wire?.action?.type, query: search.wire?.action?.query },
    { type: "search", query: "dcode release notes" },
  );
  // Citations are message-level, not round-level, so they land on the message.
  assert.deepEqual(output.hostedSearchCitations, [
    { url: "https://example.com/release", title: "Release notes" },
  ]);
});

test("pi-ai patch: malformed annotations and unknown web_search_call shapes are ignored", async () => {
  const { output } = await processEvents([
    {
      type: "response.output_text.annotation.added",
      output_index: 0,
      // Missing url: dropped rather than crashing the turn.
      annotation: { type: "url_citation", title: "no url" },
    },
    {
      type: "response.output_text.annotation.added",
      output_index: 0,
      annotation: { type: "something_else", url: "https://example.com" },
    },
    {
      type: "response.web_search_call.completed",
      // No item payload: nothing to slot, and no error.
      output_index: 3,
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant" },
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "ok", annotations: [] }],
      },
    },
    { type: "response.completed", response: { id: "resp_2", usage: {} } },
  ]);

  assert.equal(output.hostedSearchCitations, undefined);
  assert.equal(hostedSearchBlocks(output).length, 0);
  // `toMatchObject` is the natural comparison here, but the processor also
  // stamps a `textSignature` on the block, which this case does not pin.
  assert.partialDeepStrictEqual(
    output.content.find((block) => (block ?? {}).type === "text"),
    { type: "text", text: "ok" },
  );
});

test("pi-ai patch: convertMessages replays a hostedSearch block as a web_search_call item", async () => {
  const { convertResponsesMessages } = await import(
    "@earendil-works/pi-ai/api/openai-responses-shared"
  );
  const model = { id: "gpt-test", api: "openai-responses", provider: "openai", input: ["text"] };
  const context = {
    messages: [
      { role: "user", content: "search for the release notes" },
      {
        role: "assistant",
        content: [
          {
            type: "hostedSearch",
            phase: "web_search_call",
            blockId: "ws_1",
            status: "completed",
            wire: {
              type: "web_search_call",
              id: "ws_1",
              status: "completed",
              action: { type: "search", query: "dcode release notes" },
            },
          },
          { type: "text", text: "Found it." },
        ],
        api: "openai-responses",
        provider: "openai",
        model: "gpt-test",
      },
    ],
  };

  const replay = convertResponsesMessages(model, context, new Set(), {});
  const searchItem = replay.find((item) => item.type === "web_search_call");
  assert.ok(searchItem, "the persisted block must replay as a wire item, not be dropped");
  assert.equal(searchItem.id, "ws_1");
  assert.equal(searchItem.status, "completed");
  assert.equal(searchItem.action?.query, "dcode release notes");
});

test("pi-ai patch: each round emits hosted_search_update as it starts and finishes", async () => {
  const { output, stream } = await processEvents([
    { type: "response.created", response: { id: "resp_1" } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: "web_search_call",
        id: "ws_1",
        status: "in_progress",
        action: { type: "search", query: "first query" },
      },
    },
    {
      type: "response.output_item.added",
      output_index: 1,
      item: {
        type: "web_search_call",
        id: "ws_2",
        status: "in_progress",
        action: { type: "search", query: "second query" },
      },
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "web_search_call",
        id: "ws_1",
        status: "completed",
        action: { type: "search", query: "first query" },
      },
    },
    {
      type: "response.output_item.done",
      output_index: 1,
      item: {
        type: "web_search_call",
        id: "ws_2",
        status: "completed",
        action: { type: "search", query: "second query" },
      },
    },
    { type: "response.completed", response: { id: "resp_1", usage: {} } },
  ]);

  // Each round is its own block, in provider order.
  const blocks = hostedSearchBlocks(output);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].blockId, "ws_1");
  assert.equal(blocks[1].blockId, "ws_2");
  assert.equal(blocks[0].status, "completed");
  assert.equal(blocks[1].status, "completed");

  // Two starts + two finishes: progress reaches the consumer per round.
  const updates = stream.filter((event) => event.type === "hosted_search_update");
  assert.equal(updates.length, 4);
  assert.deepEqual(
    updates.map((event) => event.contentIndex),
    [0, 1, 0, 1],
  );
});

test("pi-ai patch: the responses request carries the search tool and the sources include", async () => {
  const { streamSimple } = await import("@earendil-works/pi-ai/api/openai-responses");
  let payload;
  const sse =
    "event: response.completed\n" +
    'data: {"type":"response.completed","response":{"id":"r1","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n';
  const stream = streamSimple(
    {
      id: "kimi-k2.8",
      api: "openai-responses",
      provider: "self",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 8_192,
      baseUrl: "http://localhost/v1",
      webSearch: true,
    },
    { messages: [] },
    {
      apiKey: "test",
      onPayload: (params) => {
        payload = params;
      },
      fetch: async () =>
        new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    },
  );
  const result = await stream.result();
  assert.equal(result.stopReason, "stop");
  assert.ok(payload, "onPayload must have run, or the assertion below is vacuous");
  assert.deepEqual(payload.tools, [{ type: "web_search" }]);
  assert.deepEqual(payload.include, ["web_search_call.action.sources"]);
});

test("pi-ai patch: the sources include merges with the reasoning include", async () => {
  const { streamSimple } = await import("@earendil-works/pi-ai/api/openai-responses");
  let payload;
  const sse =
    "event: response.completed\n" +
    'data: {"type":"response.completed","response":{"id":"r1","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n';
  // Any explicit effort arms the reasoning branch, which assigns
  // `params.include` outright — the merge must survive that.
  const stream = streamSimple(
    {
      id: "kimi-k2.8",
      api: "openai-responses",
      provider: "self",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 8_192,
      baseUrl: "http://localhost/v1",
      webSearch: true,
      thinkingLevelMap: { high: "high" },
    },
    { messages: [] },
    {
      apiKey: "test",
      reasoning: "high",
      onPayload: (params) => {
        payload = params;
      },
      fetch: async () =>
        new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    },
  );
  await stream.result();
  assert.ok(payload, "onPayload must have run, or the assertions below are vacuous");
  assert.ok(
    payload.include.includes("reasoning.encrypted_content"),
    `the reasoning include was dropped: ${JSON.stringify(payload.include)}`,
  );
  assert.ok(
    payload.include.includes("web_search_call.action.sources"),
    `the sources include was dropped: ${JSON.stringify(payload.include)}`,
  );
  assert.equal(payload.reasoning?.effort, "high");
});

test("pi-ai patch: a model without the opt-in sends no search tool", async () => {
  const { streamSimple } = await import("@earendil-works/pi-ai/api/openai-responses");
  let payload;
  const sse =
    "event: response.completed\n" +
    'data: {"type":"response.completed","response":{"id":"r1","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n';
  const stream = streamSimple(
    {
      id: "kimi-k2.8",
      api: "openai-responses",
      provider: "self",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 8_192,
      baseUrl: "http://localhost/v1",
    },
    { messages: [] },
    {
      apiKey: "test",
      onPayload: (params) => {
        payload = params;
      },
      fetch: async () =>
        new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    },
  );
  await stream.result();
  assert.ok(payload, "onPayload must have run, or the assertion below is vacuous");
  assert.equal(
    payload.tools,
    undefined,
    "the search tool must be attached only when the model opts in",
  );
  assert.equal(payload.include, undefined);
});

test("pi-ai patch: the anthropic wire attaches its own search tool and extracts its blocks", async () => {
  // Only `openai-responses-shared` is driven elsewhere, so the
  // anthropic-messages hunks of the same patch would otherwise be unguarded.
  const { streamSimple } = await import("@earendil-works/pi-ai/api/anthropic-messages");
  let payload;
  const sse = [
    "event: message_start",
    'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
    "",
    "event: content_block_start",
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"srvtoolu_01","name":"web_search","input":{}}}',
    "",
    "event: content_block_delta",
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"dcode\\"}"}}',
    "",
    "event: content_block_stop",
    'data: {"type":"content_block_stop","index":0}',
    "",
    "event: content_block_start",
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"web_search_tool_result","tool_use_id":"srvtoolu_01","content":[{"type":"web_search_result","url":"https://example.com/a","title":"A"}]}}',
    "",
    "event: content_block_stop",
    'data: {"type":"content_block_stop","index":1}',
    "",
    "event: message_delta",
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
    "",
    "event: message_stop",
    'data: {"type":"message_stop"}',
    "",
  ].join("\n");

  const stream = streamSimple(
    {
      id: "claude-test",
      api: "anthropic-messages",
      provider: "self",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 8_192,
      baseUrl: "http://localhost/v1",
      webSearch: true,
    },
    { messages: [] },
    {
      apiKey: "test",
      onPayload: (params) => {
        payload = params;
      },
      fetch: async () =>
        new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    },
  );
  const result = await stream.result();

  assert.ok(payload, "onPayload must have run, or the assertion below is vacuous");
  assert.ok(
    (payload.tools ?? []).some(
      (tool) => tool.type === "web_search_20250305" && tool.name === "web_search",
    ),
    `the anthropic search tool was not attached: ${JSON.stringify(payload.tools)}`,
  );

  const blocks = (result.content ?? []).filter(
    (block) => (block ?? {}).type === "hostedSearch",
  );
  assert.ok(
    blocks.length > 0,
    `no hostedSearch block was extracted from the anthropic stream: ${JSON.stringify(result.content)}`,
  );
  assert.deepEqual(
    blocks.map((block) => block.phase).sort(),
    ["server_tool_use", "web_search_tool_result"],
  );
  assert.equal(blocks[0].blockId, "srvtoolu_01");
});

test("pi-agent-core patch: hosted_search_update is forwarded as message_update", async () => {
  // Without the agent-loop patch the loop's switch drops the event and search
  // rounds render only after the whole turn finishes.
  const { agentLoop } = await import("@earendil-works/pi-agent-core");

  const partial = {
    role: "assistant",
    content: [
      {
        type: "hostedSearch",
        phase: "web_search_call",
        blockId: "ws_1",
        status: "in_progress",
        wire: { type: "web_search_call", id: "ws_1", status: "in_progress" },
      },
    ],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-test",
    stopReason: "pending",
    usage: {},
    timestamp: Date.now(),
  };
  const finalMessage = {
    ...partial,
    stopReason: "stop",
    content: [{ ...partial.content[0], status: "completed" }, { type: "text", text: "done" }],
  };
  const streamEvents = [
    { type: "start", partial },
    { type: "hosted_search_update", contentIndex: 0, partial },
    { type: "done" },
  ];
  const streamFn = () => {
    const iterable = (async function* () {
      for (const event of streamEvents) yield event;
    })();
    return Object.assign(iterable, { result: async () => finalMessage });
  };

  const emitted = [];
  const agentStream = agentLoop(
    [{ role: "user", content: "search please", timestamp: Date.now() }],
    { systemPrompt: "", messages: [], tools: [] },
    {
      model: { id: "gpt-test", api: "openai-responses", provider: "openai" },
      convertToLlm: async (messages) => messages,
    },
    new AbortController().signal,
    streamFn,
  );
  for await (const event of agentStream) emitted.push(event);

  const updates = emitted.filter((event) => event.type === "message_update");
  assert.equal(updates.length, 1, "the progress event must reach the consumer as message_update");
  assert.deepEqual(updates[0].message.content[0], {
    type: "hostedSearch",
    phase: "web_search_call",
    blockId: "ws_1",
    status: "in_progress",
    wire: { type: "web_search_call", id: "ws_1", status: "in_progress" },
  });
  assert.ok(
    emitted.some((event) => event.type === "message_end"),
    "the forwarded event must not swallow the turn's terminal frame",
  );
});
