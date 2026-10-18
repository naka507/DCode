import { describe, expect, it, vi } from "vitest";

import {
  InMemoryTurnEventSink,
  TurnStateMachine,
} from "../../src/agent/turn/index.js";

function machine() {
  const sink = new InMemoryTurnEventSink();
  const tracker = new TurnStateMachine({
    turnId: "t1",
    sessionId: "s1",
    sinks: [sink],
  });
  return { sink, tracker };
}

describe("TurnStateMachine (ADR-001 Phase A)", () => {
  it("emits turn.started on construction with status pending", () => {
    const { sink, tracker } = machine();
    expect(tracker.getRecord().status).toBe("pending");
    const started = sink.eventsOfType("turn.started");
    expect(started).toHaveLength(1);
    expect(started[0].turnId).toBe("t1");
    expect(started[0].sessionId).toBe("s1");
  });

  it("begin() moves pending -> active", () => {
    const { tracker } = machine();
    tracker.begin();
    expect(tracker.getRecord().status).toBe("active");
  });

  it("setPhase emits phase_changed and ignores repeat phases", () => {
    const { sink, tracker } = machine();
    tracker.begin();
    tracker.setPhase("executing");
    tracker.setPhase("executing");
    const changes = sink.eventsOfType("turn.phase_changed");
    expect(changes).toHaveLength(1);
    expect(changes[0].from).toBe("starting");
    expect(changes[0].to).toBe("executing");
    expect(tracker.getRecord().phase).toBe("executing");
  });

  it("notifyToolCompleted counts tools and records the event", () => {
    const { sink, tracker } = machine();
    tracker.begin();
    tracker.notifyToolCompleted("Read", 120, true);
    tracker.notifyToolCompleted("Bash", 3000, false);
    expect(tracker.getRecord().toolCallCount).toBe(2);
    const tools = sink.eventsOfType("turn.tool_completed");
    expect(tools).toHaveLength(2);
    expect(tools[0].toolName).toBe("Read");
    expect(tools[0].ok).toBe(true);
    expect(tools[1].ok).toBe(false);
  });

  it("approval request/resolve moves through awaiting_approval", () => {
    const { tracker } = machine();
    tracker.begin();
    tracker.notifyApproval("requested");
    expect(tracker.getRecord().status).toBe("awaiting_approval");
    tracker.notifyApproval("resolved", true);
    expect(tracker.getRecord().status).toBe("active");
  });

  it("end() is idempotent and emits turn.ended exactly once", () => {
    const { sink, tracker } = machine();
    tracker.begin();
    tracker.end("completed");
    tracker.end("failed");
    tracker.setPhase("retrying");
    expect(tracker.getRecord().status).toBe("completed");
    expect(tracker.getRecord().outcome).toBe("completed");
    expect(tracker.getRecord().endedAt).toBeDefined();
    expect(sink.eventsOfType("turn.ended")).toHaveLength(1);
    // No events leak after the terminal state.
    expect(sink.getEvents().at(-1)?.type).toBe("turn.ended");
  });

  it("end() records the error detail", () => {
    const { sink, tracker } = machine();
    tracker.begin();
    tracker.end("failed", {
      code: "PROVIDER_TIMEOUT",
      message: "timed out",
      retriable: true,
    });
    const ended = sink.eventsOfType("turn.ended")[0];
    expect(ended.outcome).toBe("failed");
    expect(ended.error?.code).toBe("PROVIDER_TIMEOUT");
    expect(ended.error?.retriable).toBe(true);
  });

  it("illegal transitions are ignored, never thrown", () => {
    const { tracker } = machine();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      // pending -> suspended is illegal; must not throw and must not change state.
      tracker.suspend();
      expect(tracker.getRecord().status).toBe("pending");
      expect(stderr).toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });

  it("a failing sink never breaks the observed turn", () => {
    const badSink = {
      append: () => {
        throw new Error("sink exploded");
      },
    };
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const tracker = new TurnStateMachine({
        turnId: "t9",
        sessionId: "s9",
        sinks: [badSink],
      });
      expect(() => {
        tracker.begin();
        tracker.setPhase("executing");
        tracker.end("completed");
      }).not.toThrow();
      expect(tracker.getRecord().status).toBe("completed");
    } finally {
      stderr.mockRestore();
    }
  });
});
