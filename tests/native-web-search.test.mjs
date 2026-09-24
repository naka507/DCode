/**
 * Provider-hosted web search: the shared normalization module.
 *
 * `2e763893` ("feat(providers): opt in to provider-hosted web search per
 * model") and `003bc0ae`, which added the `replay` capture on top, grew the
 * suite for the module that lives at `src/shared/native-web-search.ts`. The
 * `.test.ts` copy at `tests/shared/native-web-search.test.ts` runs under
 * `npm run test:unit`; the load-bearing cases are mirrored here as well, so
 * `npm test` covers them too.
 *
 * What is load-bearing, in the order the module defines it:
 *
 *  1. `resolveNativeWebSearch` is the runtime gate: capable wire AND the
 *     per-binding opt-in, never a vendor name or a model-id substring.
 *  2. `nativeWebSearchSupportedOn` is the settings gate, and it must accept
 *     both the stored `apiStyle` spelling and the resolved wire spelling or
 *     the checkbox is permanently disabled.
 *  3. `hostedSearchFromBlocks` turns untrusted provider blocks into display
 *     rounds. It must never throw, must keep provider order, must pair an
 *     Anthropic `server_tool_use` with its result, and must fold
 *     citation-only URLs into the most recent round.
 *  4. `hostedSearchRounds` keeps pre-revert transcripts rendering through its
 *     legacy branch.
 *  5. `hostedSearchReplayBlocks` / `hostedSearchFromMessage` are what the
 *     runtime persists so `convertMessages` can ground later turns.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const {
  hostedSearchFromBlocks,
  hostedSearchFromMessage,
  hostedSearchReplayBlocks,
  hostedSearchRounds,
  nativeWebSearchSupportedOn,
  nativeWebSearchToolFor,
  resolveNativeWebSearch,
} = await import("../src/shared/native-web-search.ts");

test("resolveNativeWebSearch turns on only for wires that define a hosted search tool", () => {
  for (const wire of [
    "anthropic-messages",
    "openai-responses",
    "azure-openai-responses",
  ]) {
    assert.equal(
      resolveNativeWebSearch({ wireApi: wire, modelWebSearch: true }),
      "on",
      `${wire} carries the hosted search tool, so the opt-in must arm it`,
    );
  }
});

test("resolveNativeWebSearch stays off for wires without a hosted search tool", () => {
  for (const wire of [
    "openai-completions",
    "openai-codex-responses",
    "google-generative-ai",
    "pi-messages",
    "",
  ]) {
    assert.equal(
      resolveNativeWebSearch({ wireApi: wire, modelWebSearch: true }),
      "off",
      // A gateway on a chat-completions wire stays off no matter what the
      // binding says: the wire cannot carry the tool, and guessing from a
      // vendor key or a base-URL hostname is what `2e763893` removed.
      `${wire} has no hosted search tool, so the binding cannot turn one on`,
    );
  }
});

test("resolveNativeWebSearch requires the explicit binding opt-in; absence is off", () => {
  assert.equal(resolveNativeWebSearch({ wireApi: "openai-responses" }), "off");
  assert.equal(
    resolveNativeWebSearch({ wireApi: "openai-responses", modelWebSearch: false }),
    "off",
  );
  assert.equal(
    resolveNativeWebSearch({ wireApi: "openai-responses", modelWebSearch: undefined }),
    "off",
  );
});

test("resolveNativeWebSearch normalizes wire spelling before matching", () => {
  assert.equal(
    resolveNativeWebSearch({ wireApi: " Anthropic-Messages ", modelWebSearch: true }),
    "on",
  );
});

test("nativeWebSearchToolFor maps each supported wire to its vendor tool shape", () => {
  assert.deepEqual(nativeWebSearchToolFor("anthropic-messages"), {
    type: "web_search_20250305",
    name: "web_search",
  });
  assert.deepEqual(nativeWebSearchToolFor("openai-responses"), { type: "web_search" });
  assert.deepEqual(nativeWebSearchToolFor("azure-openai-responses"), {
    type: "web_search",
  });
  // A fresh object each call: the caller may attach it to a request payload and
  // the exported constant must not be mutable through it.
  assert.notEqual(
    nativeWebSearchToolFor("anthropic-messages"),
    nativeWebSearchToolFor("anthropic-messages"),
  );
});

test("nativeWebSearchToolFor returns undefined for wires without a tool shape", () => {
  assert.equal(nativeWebSearchToolFor("openai-completions"), undefined);
  assert.equal(nativeWebSearchToolFor(""), undefined);
});

test("nativeWebSearchSupportedOn accepts stored apiStyle and resolved wire spellings", () => {
  // Both spellings reach this predicate: the settings pane holds the stored
  // `apiStyle` (`responses` / `anthropic_messages`) while a resolved wire is
  // `openai-responses` / `anthropic-messages`. Rejecting either one leaves the
  // per-model checkbox permanently disabled on a capable provider.
  for (const api of [
    "responses",
    "anthropic_messages",
    "openai-responses",
    "azure-openai-responses",
    "anthropic-messages",
  ]) {
    assert.equal(nativeWebSearchSupportedOn(api), true, `${api} can carry the tool`);
  }
});

test("nativeWebSearchSupportedOn rejects wires without a hosted search tool", () => {
  for (const api of [
    "chat_completions",
    "openai-completions",
    "openai_codex_responses",
    undefined,
    "",
  ]) {
    assert.equal(nativeWebSearchSupportedOn(api), false, `${api} cannot carry the tool`);
  }
});

test("hostedSearchFromBlocks normalizes a responses web_search_call into one round", () => {
  const search = hostedSearchFromBlocks({
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
          results: [
            { url: "https://example.com/a", title: "A" },
            { url: "https://example.com/b", title: "  " },
          ],
        },
      },
    ],
    citations: [
      { url: "https://example.com/a", title: "A" },
      { url: "https://example.com/c", title: "C" },
      { url: "not-a-url" },
    ],
  });
  assert.deepEqual(search, {
    status: "completed",
    rounds: [
      {
        id: "ws_1",
        status: "completed",
        query: "dcode release notes",
        sources: [
          { url: "https://example.com/a", title: "A" },
          // A whitespace-only title is dropped rather than rendered as blank.
          { url: "https://example.com/b" },
          // Citation-only URLs fold into the most recent round, deduped.
          { url: "https://example.com/c", title: "C" },
        ],
      },
    ],
  });
});

test("hostedSearchFromBlocks keeps each search round separate, in provider order", () => {
  const search = hostedSearchFromBlocks({
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
          action: {
            type: "search",
            query: "first query",
            sources: [{ url: "https://example.com/1" }],
          },
        },
      },
      {
        type: "hostedSearch",
        phase: "web_search_call",
        blockId: "ws_2",
        status: "in_progress",
        wire: {
          type: "web_search_call",
          id: "ws_2",
          status: "in_progress",
          action: { type: "search", query: "second query" },
        },
      },
    ],
  });
  assert.deepEqual(search, {
    // One round still in flight keeps the aggregate searching, which is what
    // keeps the row's live label honest while the turn continues.
    status: "searching",
    rounds: [
      {
        id: "ws_1",
        status: "completed",
        query: "first query",
        sources: [{ url: "https://example.com/1" }],
      },
      { id: "ws_2", status: "searching", query: "second query", sources: [] },
    ],
  });
});

test("hostedSearchFromBlocks pairs an anthropic server_tool_use with its result", () => {
  const search = hostedSearchFromBlocks({
    content: [
      {
        type: "hostedSearch",
        phase: "server_tool_use",
        blockId: "srvu_1",
        name: "web_search",
        input: { query: "rust async" },
      },
      {
        type: "hostedSearch",
        phase: "web_search_tool_result",
        blockId: "srvu_1",
        wire: {
          type: "web_search_tool_result",
          tool_use_id: "srvu_1",
          content: [
            {
              type: "web_search_result",
              url: "https://example.com/rust",
              title: "Rust async",
            },
          ],
        },
      },
    ],
  });
  assert.deepEqual(search, {
    status: "completed",
    rounds: [
      {
        id: "srvu_1",
        status: "completed",
        query: "rust async",
        sources: [{ url: "https://example.com/rust", title: "Rust async" }],
      },
    ],
  });
});

test("hostedSearchFromBlocks marks an anthropic error result as a failed round", () => {
  const search = hostedSearchFromBlocks({
    content: [
      {
        type: "hostedSearch",
        phase: "server_tool_use",
        blockId: "srvu_1",
        input: { query: "rust async" },
      },
      {
        type: "hostedSearch",
        phase: "web_search_tool_result",
        blockId: "srvu_1",
        isError: true,
        wire: {
          type: "web_search_tool_result_error",
          tool_use_id: "srvu_1",
          content: "search unavailable",
        },
      },
    ],
  });
  assert.deepEqual(search, {
    status: "failed",
    rounds: [{ id: "srvu_1", status: "failed", query: "rust async", sources: [] }],
  });
});

test("hostedSearchFromBlocks pairs an id-less result with the latest round still searching", () => {
  const search = hostedSearchFromBlocks({
    content: [
      {
        type: "hostedSearch",
        phase: "server_tool_use",
        blockId: "srvu_1",
        input: { query: "done round" },
      },
      {
        type: "hostedSearch",
        phase: "web_search_tool_result",
        blockId: "srvu_1",
        wire: { type: "web_search_tool_result", content: [] },
      },
      {
        type: "hostedSearch",
        phase: "server_tool_use",
        blockId: "srvu_2",
        input: { query: "open round" },
      },
      // A gateway that drops the tool_use_id still lands the result on the
      // round that is actually open instead of inventing a new one.
      {
        type: "hostedSearch",
        phase: "web_search_tool_result",
        wire: {
          type: "web_search_tool_result",
          content: [{ url: "https://example.com/open" }],
        },
      },
    ],
  });
  assert.deepEqual(search?.rounds, [
    { id: "srvu_1", status: "completed", query: "done round", sources: [] },
    {
      id: "srvu_2",
      status: "completed",
      query: "open round",
      sources: [{ url: "https://example.com/open" }],
    },
  ]);
});

test("hostedSearchFromBlocks labels responses open_page and find_in_page rounds", () => {
  const search = hostedSearchFromBlocks({
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
          action: { type: "search", query: "openclaw latest" },
        },
      },
      {
        type: "hostedSearch",
        phase: "web_search_call",
        blockId: "ws_2",
        status: "completed",
        wire: {
          type: "web_search_call",
          id: "ws_2",
          status: "completed",
          action: { type: "open_page", url: "https://www.npmjs.com/package/openclaw" },
        },
      },
      {
        type: "hostedSearch",
        phase: "web_search_call",
        blockId: "ws_3",
        status: "completed",
        wire: {
          type: "web_search_call",
          id: "ws_3",
          status: "completed",
          action: {
            type: "find_in_page",
            url: "https://docs.openclaw.ai/releases",
            pattern: "2026.9",
          },
        },
      },
    ],
  });
  assert.deepEqual(search?.rounds, [
    { id: "ws_1", status: "completed", query: "openclaw latest", sources: [] },
    {
      id: "ws_2",
      status: "completed",
      kind: "openPage",
      url: "https://www.npmjs.com/package/openclaw",
      sources: [],
    },
    {
      id: "ws_3",
      status: "completed",
      kind: "findInPage",
      url: "https://docs.openclaw.ai/releases",
      query: "2026.9",
      sources: [],
    },
  ]);
});

test("hostedSearchFromBlocks labels an anthropic web_fetch use as an open-page round", () => {
  const search = hostedSearchFromBlocks({
    content: [
      {
        type: "hostedSearch",
        phase: "server_tool_use",
        blockId: "srvu_9",
        name: "web_fetch",
        input: { url: "https://example.com/page" },
      },
      {
        type: "hostedSearch",
        phase: "web_search_tool_result",
        blockId: "srvu_9",
        wire: { type: "web_search_tool_result", content: [] },
      },
    ],
  });
  assert.deepEqual(search?.rounds, [
    {
      id: "srvu_9",
      status: "completed",
      kind: "openPage",
      url: "https://example.com/page",
      sources: [],
    },
  ]);
});

test("hostedSearchFromBlocks reads the query from gateway-native search field names", () => {
  // GLM's web_search_prime (relayed by gateways onto the anthropic wire) names
  // its input field `search_query`, not `query`.
  const search = hostedSearchFromBlocks({
    content: [
      {
        type: "hostedSearch",
        phase: "server_tool_use",
        blockId: "srvu_glm",
        name: "web_search_prime",
        input: { location: "us", search_query: "OpenClaw latest version release" },
      },
    ],
  });
  assert.deepEqual(search?.rounds, [
    {
      id: "srvu_glm",
      status: "searching",
      query: "OpenClaw latest version release",
      sources: [],
    },
  ]);
});

test("hostedSearchFromBlocks returns undefined without blocks and never throws on junk", () => {
  assert.equal(hostedSearchFromBlocks({ content: [] }), undefined);
  assert.equal(
    hostedSearchFromBlocks({ content: [{ type: "text", text: "hi" }] }),
    undefined,
  );
  // A block without a recognized phase carries no round information.
  assert.equal(
    hostedSearchFromBlocks({ content: [null, 7, { type: "hostedSearch" }] }),
    undefined,
  );
  assert.deepEqual(
    hostedSearchFromBlocks({
      content: [{ type: "hostedSearch", phase: "web_search_call", wire: "junk" }],
      citations: [{ url: "ftp://nope" }],
    }),
    {
      status: "searching",
      rounds: [{ id: "anon-0", status: "searching", sources: [] }],
    },
  );
});

test("hostedSearchRounds passes through the per-round shape", () => {
  const rounds = [{ id: "ws_1", status: "completed", query: "q", sources: [] }];
  assert.deepEqual(hostedSearchRounds({ status: "completed", rounds }), rounds);
});

test("hostedSearchRounds collapses a v1 aggregate transcript into one legacy round", () => {
  // Pre-revert development builds persisted the flat `{status, queries,
  // sources}` shape. Dropping it would blank the row on every old transcript.
  assert.deepEqual(
    hostedSearchRounds({
      status: "completed",
      queries: ["old query"],
      sources: [{ url: "https://example.com/a", title: "A" }],
    }),
    [
      {
        id: "legacy",
        status: "completed",
        query: "old query",
        sources: [{ url: "https://example.com/a", title: "A" }],
      },
    ],
  );
});

test("hostedSearchRounds reads nothing from empty or missing data", () => {
  assert.deepEqual(hostedSearchRounds(undefined), []);
  assert.deepEqual(hostedSearchRounds({ status: "completed", rounds: [] }), []);
  assert.deepEqual(
    hostedSearchRounds({ status: "completed", queries: [], sources: [] }),
    [],
  );
});

test("hostedSearchReplayBlocks keeps wire payloads and drops streaming scratch", () => {
  assert.deepEqual(
    hostedSearchReplayBlocks([
      {
        type: "hostedSearch",
        phase: "server_tool_use",
        blockId: "srvtoolu_01",
        name: "web_search",
        input: { query: "dcode" },
        index: 2,
        inputJson: '{"query":"dcode"}',
      },
      {
        type: "hostedSearch",
        phase: "web_search_tool_result",
        blockId: "srvtoolu_01",
        wire: { type: "web_search_tool_result", encrypted_content: "enc-1" },
      },
      { type: "text", text: "answer" },
    ]),
    [
      {
        type: "hostedSearch",
        phase: "server_tool_use",
        blockId: "srvtoolu_01",
        name: "web_search",
        input: { query: "dcode" },
      },
      {
        type: "hostedSearch",
        phase: "web_search_tool_result",
        blockId: "srvtoolu_01",
        wire: { type: "web_search_tool_result", encrypted_content: "enc-1" },
      },
    ],
  );
});

test("hostedSearchReplayBlocks ignores junk and empty input", () => {
  assert.deepEqual(hostedSearchReplayBlocks(undefined), []);
  assert.deepEqual(hostedSearchReplayBlocks([{ type: "hostedSearch" }]), []);
  assert.deepEqual(hostedSearchReplayBlocks("nope"), []);
});

test("hostedSearchFromMessage attaches replay next to the display rounds", () => {
  const content = [
    {
      type: "hostedSearch",
      phase: "web_search_call",
      blockId: "ws_1",
      status: "completed",
      wire: {
        type: "web_search_call",
        id: "ws_1",
        status: "completed",
        action: { type: "search", query: "q" },
      },
    },
  ];
  const search = hostedSearchFromMessage({ content });
  assert.deepEqual(search?.rounds, [
    { id: "ws_1", status: "completed", query: "q", sources: [] },
  ]);
  assert.deepEqual(search?.replay, [
    {
      type: "hostedSearch",
      phase: "web_search_call",
      blockId: "ws_1",
      status: "completed",
      wire: {
        type: "web_search_call",
        id: "ws_1",
        status: "completed",
        action: { type: "search", query: "q" },
      },
    },
  ]);
});
