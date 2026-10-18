/**
 * ADR-001 Phase B: DCore RPC sink contract tests.
 *
 * The sink is fire-and-forget by design — every test below also proves the
 * observer principle: a persistence failure never surfaces to the caller.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DCoreTurnEventSink,
  TURN_EVENT_MAX_PAYLOAD_BYTES,
} from "../../src/agent/turn/dcore-sink.js";
import type { TurnEvent } from "../../src/agent/turn/types.js";

const baseEvent: TurnEvent = {
  type: "turn.started",
  turnId: "turn-1",
  sessionId: "session-1",
  at: 1234567890,
};

/** Let the sink's fire-and-forget promise settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("DCoreTurnEventSink (ADR-001 Phase B)", () => {
  let calls: Array<{ method: string; params: Record<string, unknown> }>;
  let transport: { call: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    calls = [];
    transport = {
      call: vi.fn(async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        return { seq: calls.length };
      }),
    };
    vi.restoreAllMocks();
  });

  it("maps events to turn.appendEvent params", async () => {
    const sink = new DCoreTurnEventSink(transport);
    sink.append({
      type: "turn.tool_completed",
      turnId: "turn-1",
      sessionId: "session-1",
      at: 42,
      toolName: "Bash",
      durationMs: 120,
      ok: true,
    });
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("turn.appendEvent");
    expect(calls[0].params.turnId).toBe("turn-1");
    expect(calls[0].params.type).toBe("turn.tool_completed");
    const payload = calls[0].params.payload as Record<string, unknown>;
    expect(payload.toolName).toBe("Bash");
    expect(payload.durationMs).toBe(120);
    expect(payload.at).toBe(42);
    // turnId/type ride as top-level params; sessionId is redundant.
    expect(payload).not.toHaveProperty("turnId");
    expect(payload).not.toHaveProperty("type");
    expect(payload).not.toHaveProperty("sessionId");
  });

  it("never throws on transport failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    transport.call.mockRejectedValueOnce(new Error("boom"));
    const sink = new DCoreTurnEventSink(transport);

    expect(() => sink.append(baseEvent)).not.toThrow();
    await flush();

    expect(calls).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("truncates oversized payloads defensively", async () => {
    const sink = new DCoreTurnEventSink(transport);
    sink.append({
      type: "turn.tool_completed",
      turnId: "turn-1",
      sessionId: "session-1",
      at: 9,
      toolName: "x".repeat(TURN_EVENT_MAX_PAYLOAD_BYTES + 1),
      durationMs: 0,
      ok: true,
    });
    await flush();

    const payload = calls[0].params.payload as Record<string, unknown>;
    expect(payload._truncated).toBe(true);
    expect(payload.at).toBe(9);
    expect(JSON.stringify(payload).length).toBeLessThan(
      TURN_EVENT_MAX_PAYLOAD_BYTES,
    );
  });

  it("warns once per turn on 1007 TURN_NOT_FOUND", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const notFound = Object.assign(new Error("turn not found"), {
      code: 1007,
      data: { errorCode: "TURN_NOT_FOUND" },
    });
    transport.call.mockRejectedValue(notFound);
    const sink = new DCoreTurnEventSink(transport);

    sink.append(baseEvent);
    sink.append({
      type: "turn.ended",
      turnId: "turn-1",
      sessionId: "session-1",
      at: 10,
      outcome: "completed",
      usage: { inputTokens: 0, outputTokens: 0, compactionTokens: 0 },
    });
    await flush();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("still logs non-1007 errors as errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    transport.call.mockRejectedValueOnce(
      Object.assign(new Error("internal"), { code: 1000 }),
    );
    const sink = new DCoreTurnEventSink(transport);

    sink.append(baseEvent);
    await flush();

    expect(errorSpy).toHaveBeenCalled();
  });
});
