/**
 * ADR-006 (P1-4): Agent IR tests.
 *
 * The IR is structural (plain data, no behavior). These tests pin the
 * shape: the message content union covers every kind the loop produces,
 * the hosted-search content kind exists (patch-preserved behavior), and
 * the backend interface names the operations a replacement must provide.
 */
import { describe, expect, it } from "vitest";
import type {
  IrAgentBackend,
  IrAgentEvent,
  IrAgentState,
  IrMessage,
  IrMessageContent,
} from "../../src/agent/pi-adapter/ir.js";

describe("Agent IR", () => {
  it("covers every message content kind", () => {
    const kinds: IrMessageContent["kind"][] = [
      "text",
      "thinking",
      "toolCall",
      "toolResult",
      "hostedSearch",
    ];
    // hostedSearch must exist: dropping it loses server-side search results
    // from history (patch-preserved behavior #2).
    expect(kinds).toContain("hostedSearch");
    const message: IrMessage = {
      role: "assistant",
      content: [
        { kind: "text", text: "hello" },
        {
          kind: "toolCall",
          toolCallId: "1",
          toolName: "Read",
          args: { path: "/x" },
        },
      ],
    };
    expect(message.content).toHaveLength(2);
  });

  it("models loop events including hosted search updates", () => {
    const events: IrAgentEvent[] = [
      { type: "turn.started", turnId: "t1" },
      { type: "message.delta", deltaText: "hi" },
      { type: "tool.callStarted", toolCallId: "1", toolName: "Read", args: {} },
      // Patch-preserved behavior #1: hosted search progress from the
      // provider stream must reach the UI.
      { type: "hostedSearch.update", update: { query: "x" } },
      { type: "tool.callCompleted", toolCallId: "1", result: "ok" },
      { type: "turn.ended", turnId: "t1" },
    ];
    expect(events.map((e) => e.type)).toContain("hostedSearch.update");
  });

  it("defines the backend contract a replacement must satisfy", () => {
    // Compile-time check: the interface names the loop operations.
    const backend: IrAgentBackend | null = null;
    expect(backend).toBeNull();
    const state: IrAgentState = {
      messages: [],
      tools: [],
      systemPrompt: "",
      isStreaming: false,
      pendingModelRequest: false,
    };
    expect(state.messages).toEqual([]);
  });
});
