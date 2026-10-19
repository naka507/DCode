/**
 * ADR-001 Phase C tests: turn event subscription.
 *
 * Covers the pure pieces of the UI subscription path:
 * - `applyTurnEvent`: folding turn events into the renderer's per-session
 *   turn state mirror.
 * - `toRacpTurnStatus`: local TurnStatus → RACP vocabulary mapping.
 * - `ForwardingTurnEventSink`: sidecar → renderer forwarding.
 */
import { describe, expect, it, vi } from "vitest";
import { applyTurnEvent } from "../../src/renderer/stores/slices/events-slice.js";
import { toRacpTurnStatus } from "../../src/shared/racp.js";
import { ForwardingTurnEventSink } from "../../src/agent/turn/forwarding-sink.js";
import type { TurnEvent } from "../../src/shared/types/turn.js";

const SESSION = "session-1";
const TURN = "turn-1";

function started(at = 1000): TurnEvent {
  return { type: "turn.started", turnId: TURN, sessionId: SESSION, at };
}

describe("applyTurnEvent", () => {
  it("creates a record on turn.started", () => {
    const states = applyTurnEvent({}, SESSION, started());
    expect(states[SESSION]).toMatchObject({
      turnId: TURN,
      status: "active",
      phase: "starting",
      toolCallCount: 0,
      startedAt: 1000,
    });
  });

  it("updates phase on turn.phase_changed", () => {
    let states = applyTurnEvent({}, SESSION, started());
    states = applyTurnEvent(states, SESSION, {
      type: "turn.phase_changed",
      turnId: TURN,
      sessionId: SESSION,
      at: 1100,
      from: "starting",
      to: "executing",
    });
    expect(states[SESSION].phase).toBe("executing");
  });

  it("counts completed tools", () => {
    let states = applyTurnEvent({}, SESSION, started());
    states = applyTurnEvent(states, SESSION, {
      type: "turn.tool_completed",
      turnId: TURN,
      sessionId: SESSION,
      at: 1200,
      toolName: "Read",
      durationMs: 50,
      ok: true,
    });
    expect(states[SESSION].toolCallCount).toBe(1);
  });

  it("tracks approval round-trips", () => {
    let states = applyTurnEvent({}, SESSION, started());
    states = applyTurnEvent(states, SESSION, {
      type: "turn.approval",
      turnId: TURN,
      sessionId: SESSION,
      at: 1300,
      kind: "requested",
    });
    expect(states[SESSION].status).toBe("awaiting_approval");
    states = applyTurnEvent(states, SESSION, {
      type: "turn.approval",
      turnId: TURN,
      sessionId: SESSION,
      at: 1400,
      kind: "resolved",
      approved: true,
    });
    expect(states[SESSION].status).toBe("active");
  });

  it("records the outcome on turn.ended", () => {
    let states = applyTurnEvent({}, SESSION, started());
    states = applyTurnEvent(states, SESSION, {
      type: "turn.ended",
      turnId: TURN,
      sessionId: SESSION,
      at: 2000,
      outcome: "completed",
      usage: { inputTokens: 10, outputTokens: 5, compactionTokens: 0 },
    });
    expect(states[SESSION]).toMatchObject({
      status: "completed",
      outcome: "completed",
      endedAt: 2000,
    });
  });

  it("ignores events for a turn it is not tracking", () => {
    const states = applyTurnEvent({}, SESSION, {
      type: "turn.phase_changed",
      turnId: "other-turn",
      sessionId: SESSION,
      at: 1100,
      from: "starting",
      to: "executing",
    });
    expect(states[SESSION]).toBeUndefined();
  });

  it("starts a new record when a new turn begins", () => {
    let states = applyTurnEvent({}, SESSION, started());
    states = applyTurnEvent(states, SESSION, {
      type: "turn.started",
      turnId: "turn-2",
      sessionId: SESSION,
      at: 3000,
    });
    expect(states[SESSION].turnId).toBe("turn-2");
    expect(states[SESSION].toolCallCount).toBe(0);
  });
});

describe("toRacpTurnStatus", () => {
  it("maps every local status to the RACP vocabulary", () => {
    expect(toRacpTurnStatus("pending")).toBe("queued");
    expect(toRacpTurnStatus("active")).toBe("running");
    expect(toRacpTurnStatus("awaiting_approval")).toBe("waiting_approval");
    expect(toRacpTurnStatus("suspended")).toBe("waiting_input");
    expect(toRacpTurnStatus("completed")).toBe("completed");
    expect(toRacpTurnStatus("failed")).toBe("failed");
    expect(toRacpTurnStatus("aborted")).toBe("canceled");
  });
});

describe("ForwardingTurnEventSink", () => {
  it("forwards events to the callback", () => {
    const seen: TurnEvent[] = [];
    const sink = new ForwardingTurnEventSink((event) => {
      seen.push(event);
    });
    const event = started();
    sink.append(event);
    expect(seen).toEqual([event]);
  });

  it("does not throw when the callback throws", () => {
    const sink = new ForwardingTurnEventSink(() => {
      throw new Error("boom");
    });
    expect(() => sink.append(started())).not.toThrow();
  });
});
