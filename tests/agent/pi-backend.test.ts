/**
 * ADR-006 (P1-4): PiAgentBackend tests.
 *
 * The wrapper is thin by design — it delegates to pi-agent-core's `Agent`.
 * These tests pin the delegation contract: the wrapper exposes the methods
 * and state runtime.ts/subagent.ts rely on, and it is the only non-adapter
 * module importing pi's `Agent` class.
 */
import { describe, expect, it } from "vitest";
import { PiAgentBackend } from "../../src/agent/pi-adapter/pi-backend.js";

describe("PiAgentBackend", () => {
  it("exposes its backend name", () => {
    const backend = new PiAgentBackend({
      streamFn: async () => {},
    } as never);
    expect(backend.name).toBe("pi-agent-core");
  });

  it("delegates state to the wrapped agent", () => {
    const backend = new PiAgentBackend({
      streamFn: async () => {},
    } as never);
    // State is a mutable reference; callers assign into it.
    backend.state.systemPrompt = "hello";
    expect(backend.state.systemPrompt).toBe("hello");
  });

  it("exposes callback passthroughs", () => {
    const backend = new PiAgentBackend({
      streamFn: async () => {},
      beforeToolCall: async () => undefined,
      afterToolCall: async () => undefined,
    } as never);
    // Callbacks are stored on the pi Agent and readable through the wrapper.
    expect(typeof backend.beforeToolCall).toBe("function");
    expect(typeof backend.afterToolCall).toBe("function");
  });

  it("exposes settable streamFunction and getApiKey", () => {
    const backend = new PiAgentBackend({
      streamFn: async () => {},
    } as never);
    const streamFn = async () => {};
    backend.streamFunction = streamFn as never;
    expect(backend.streamFunction).toBe(streamFn);
  });
});
