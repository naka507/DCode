/**
 * ef3b282a ("fix(agent-runtime): fail a stream that stops emitting events",
 * PR #672): `withStreamIdleTimeout` ends a provider stream that emits nothing
 * for a configurable budget, so a stalled connection re-enters the shared
 * transient retry path instead of hanging the turn forever.
 *
 * The seven cases also live in `tests/agent-runtime/provider-retry.test.ts`,
 * which runs under `npm run test:unit`; this copy is what `npm test` executes.
 *
 * vitest's `advanceTimersByTimeAsync` drains pending microtasks before it moves
 * the fake clock, and the watchdog arms its next timer from inside exactly such
 * a microtask. `node:test`'s `t.mock.timers.tick()` only moves the clock, so
 * `advance()` below reproduces the vitest ordering explicitly; without it the
 * re-armed deadline would be measured from the clock position at the end of the
 * previous tick.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const {
  classifyProviderError,
  createProviderRetryStream,
  isTransientProviderRetryCode,
  STREAM_IDLE_TIMEOUT_DEFAULT_MS,
  STREAM_IDLE_TIMEOUT_FLOOR_MS,
  streamIdleTimeoutMs,
  withStreamIdleTimeout,
} = await import("../src/agent/runtime/provider-retry.ts");

const model = {
  id: "model",
  api: "openai-completions",
  provider: "provider",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 4_000,
  baseUrl: "https://provider.invalid/v1",
};

const context = { messages: [], tools: [] };

function assistantMessage(overrides = {}) {
  return {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "provider",
    model: "model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: "429: too many requests",
    timestamp: Date.now(),
    ...overrides,
  };
}

function failedStream(overrides = {}) {
  const stream = createAssistantMessageEventStream();
  const error = assistantMessage(overrides);
  queueMicrotask(() => {
    stream.push({ type: "error", reason: "error", error });
    stream.end(error);
  });
  return stream;
}

function successfulStream() {
  const stream = createAssistantMessageEventStream();
  const message = assistantMessage({
    content: [{ type: "text", text: "recovered" }],
    stopReason: "stop",
    errorMessage: undefined,
  });
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
  });
  return stream;
}

/** Drain the pending promise queue the watchdog's driver loop advances on. */
async function flush() {
  for (let turn = 0; turn < 64; turn += 1) await Promise.resolve();
}

/**
 * vitest's `advanceTimersByTimeAsync`: settle pending microtasks first, then
 * move the fake clock, then settle again — so a timer armed from a microtask is
 * based at the pre-tick clock position.
 */
async function advance(t, ms) {
  await flush();
  t.mock.timers.tick(ms);
  await flush();
}

/** Run `body` with the idle-timeout override restored afterwards. */
function withIdleTimeoutEnv(value, body) {
  const previous = process.env.DCODE_STREAM_IDLE_TIMEOUT_MS;
  try {
    if (value === undefined) delete process.env.DCODE_STREAM_IDLE_TIMEOUT_MS;
    else process.env.DCODE_STREAM_IDLE_TIMEOUT_MS = value;
    return body();
  } finally {
    if (previous === undefined) delete process.env.DCODE_STREAM_IDLE_TIMEOUT_MS;
    else process.env.DCODE_STREAM_IDLE_TIMEOUT_MS = previous;
  }
}

test("reads the idle budget from the environment with a safe default", () => {
  withIdleTimeoutEnv(undefined, () => {
    assert.equal(streamIdleTimeoutMs(), STREAM_IDLE_TIMEOUT_DEFAULT_MS);
  });
  withIdleTimeoutEnv("45000", () => {
    assert.equal(streamIdleTimeoutMs(), 45_000);
  });
  withIdleTimeoutEnv("0", () => {
    assert.equal(streamIdleTimeoutMs(), 0);
  });
  withIdleTimeoutEnv("not-a-number", () => {
    assert.equal(streamIdleTimeoutMs(), STREAM_IDLE_TIMEOUT_DEFAULT_MS);
  });
});

test("clamps a positive override up to the retry backoff floor", () => {
  // The watchdog wraps the retry adapter, so a budget under the largest retry
  // delay would end a turn that is backing off exactly as the provider asked it
  // to. `0` still disables it outright.
  withIdleTimeoutEnv("1000", () => {
    assert.equal(streamIdleTimeoutMs(), STREAM_IDLE_TIMEOUT_FLOOR_MS);
    assert.ok(STREAM_IDLE_TIMEOUT_FLOOR_MS > 1_000);
  });
  withIdleTimeoutEnv("0", () => {
    assert.equal(streamIdleTimeoutMs(), 0);
  });
});

test("passes the stream through unchanged when the watchdog is disabled", () => {
  const stream = createAssistantMessageEventStream();
  assert.equal(withStreamIdleTimeout(stream, model, 0), stream);
});

test("forwards a productive stream unchanged", async () => {
  const wrapped = withStreamIdleTimeout(successfulStream(), model, 1_000);
  const events = [];
  for await (const event of wrapped) events.push(event.type);
  assert.deepEqual(events, ["start", "done"]);
  const result = await wrapped.result();
  assert.equal(result.stopReason, "stop");
  assert.equal(result.errorMessage, undefined);
});

test("ends a silent stream as a retriable stream failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const stalled = createAssistantMessageEventStream();
    stalled.push({ type: "start", partial: assistantMessage() });
    const wrapped = withStreamIdleTimeout(stalled, model, 1_000);

    const events = [];
    const collected = (async () => {
      for await (const event of wrapped) events.push(event.type);
    })();
    await advance(t, 600);
    assert.deepEqual(events, ["start"]);
    await advance(t, 400);
    await collected;

    assert.deepEqual(events, ["start", "error"]);
    const result = await wrapped.result();
    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage, /stream stalled/);
    // The timeout must merge into the existing transient retry path: the
    // classified code is retriable and claims the shared budget.
    const classified = classifyProviderError(result.errorMessage);
    assert.equal(classified.code, "STREAM_FAILED");
    assert.equal(classified.retriable, true);
    assert.equal(isTransientProviderRetryCode(classified.code), true);
  } finally {
    t.mock.timers.reset();
  }
});

test("resets the idle timer on every event", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const slow = createAssistantMessageEventStream();
    slow.push({ type: "start", partial: assistantMessage() });
    const wrapped = withStreamIdleTimeout(slow, model, 1_000);

    const events = [];
    const collected = (async () => {
      for await (const event of wrapped) events.push(event.type);
    })();
    // An event at t=800 re-arms the watchdog; without the reset the stream would
    // already have failed at t=1000.
    await advance(t, 800);
    slow.push({ type: "text_start", contentIndex: 0, partial: assistantMessage() });
    await flush();
    await advance(t, 800);
    assert.deepEqual(events, ["start", "text_start"]);
    await advance(t, 400);
    await collected;
    assert.deepEqual(events, ["start", "text_start", "error"]);
    assert.match((await wrapped.result()).errorMessage, /stream stalled/);
  } finally {
    t.mock.timers.reset();
  }
});

test("stops the retry adapter it abandons instead of letting it issue a second request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const controller = new AbortController();
    let attempts = 0;
    const adapter = createProviderRetryStream(
      model,
      context,
      { signal: controller.signal },
      () => {
        attempts += 1;
        return failedStream({
          errorMessage:
            'OpenAI API error (502): {"type":"api_error","message":"Upstream API request failed."}',
        });
      },
      {
        claim: (error) => (isTransientProviderRetryCode(error.code) ? 1 : undefined),
        headers: () => undefined,
        status: () => 502,
      },
    );
    // 500 ms: inside the adapter's first 1 s backoff, which is zero-event time
    // to this wrapper. The real `delayWithAbort` is used on purpose — it is the
    // thing the abort has to reject.
    const wrapped = withStreamIdleTimeout(adapter, model, 500, () => controller.abort());

    const events = [];
    const collected = (async () => {
      for await (const event of wrapped) events.push(event.type);
    })();
    // The first attempt fails retriably and the adapter starts backing off.
    // That wait is zero-event time to the watchdog, which fires inside it and
    // aborts the request: the backoff rejects instead of resolving, so the
    // adapter never opens the second request the runtime's own retry is already
    // covering.
    await advance(t, 500);
    await collected;

    assert.equal(controller.signal.aborted, true);
    assert.deepEqual(events, ["error"]);
    assert.equal(attempts, 1);
    await advance(t, 600_000);
    assert.equal(attempts, 1);
  } finally {
    t.mock.timers.reset();
  }
});
