import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import {
  applyMicrocompact,
  MICROCOMPACT_CLEARED_TOOL_RESULT,
} from "../../src/agent/runtime/microcompact.js";

function makeToolResult(
  id: string,
  toolName: string,
  text: string,
  isError = false,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName,
    content: [{ type: "text", text }],
    isError,
    timestamp: Date.now(),
  };
}

describe("microcompact", () => {
  it("leaves messages unchanged when tool result count is within keepRecent", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hello", timestamp: 1 },
      makeToolResult("call-1", "ReadFile", "long content".repeat(20)),
      makeToolResult("call-2", "Bash", "compiler output".repeat(20)),
    ];

    const result = applyMicrocompact(messages, { keepRecent: 5 });
    expect(result).toEqual(messages);
  });

  it("compacts older tool results and preserves the last N recent results", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "start", timestamp: 1 },
      makeToolResult("c1", "ReadFile", "bulk-1-".repeat(30)),
      makeToolResult("c2", "Bash", "bulk-2-".repeat(30)),
      makeToolResult("c3", "Grep", "bulk-3-".repeat(30)),
      makeToolResult("c4", "ReadFile", "bulk-4-".repeat(30)),
      makeToolResult("c5", "ReadFile", "bulk-5-".repeat(30)),
      makeToolResult("c6", "ReadFile", "recent-6-".repeat(30)),
      makeToolResult("c7", "Bash", "recent-7-".repeat(30)),
      makeToolResult("c8", "ReadFile", "recent-8-".repeat(30)),
    ];

    // Total 8 tool results. keepRecent = 3 => oldest 5 (c1..c5) get cleared, newest 3 (c6..c8) preserved.
    const compacted = applyMicrocompact(messages, { keepRecent: 3 });

    // Oldest ones cleared
    for (let i = 1; i <= 5; i++) {
      const msg = compacted[i] as ToolResultMessage;
      expect(msg.content[0]).toEqual({
        type: "text",
        text: MICROCOMPACT_CLEARED_TOOL_RESULT,
      });
      expect(msg.toolCallId).toBe(`c${i}`);
    }

    // Newest 3 preserved
    for (let i = 6; i <= 8; i++) {
      const msg = compacted[i] as ToolResultMessage;
      expect((msg.content[0] as { text: string }).text).toContain(`recent-${i}`);
    }
  });

  it("preserves error results when clearErrorResults is false", () => {
    const messages: AgentMessage[] = [
      makeToolResult("c1", "ReadFile", "error log".repeat(30), true),
      makeToolResult("c2", "ReadFile", "regular output".repeat(30), false),
      makeToolResult("c3", "ReadFile", "regular output".repeat(30), false),
    ];

    const compacted = applyMicrocompact(messages, {
      keepRecent: 1,
      clearErrorResults: false,
    });

    const errorMsg = compacted[0] as ToolResultMessage;
    expect((errorMsg.content[0] as { text: string }).text).toContain("error log");

    const regularMsg = compacted[1] as ToolResultMessage;
    expect((regularMsg.content[0] as { text: string }).text).toBe(
      MICROCOMPACT_CLEARED_TOOL_RESULT,
    );
  });

  it("does not compact short outputs below minCharsToClear", () => {
    const messages: AgentMessage[] = [
      makeToolResult("c1", "ReadFile", "short"),
      makeToolResult("c2", "ReadFile", "another short"),
    ];

    const compacted = applyMicrocompact(messages, {
      keepRecent: 1,
      minCharsToClear: 100,
    });

    expect((compacted[0] as ToolResultMessage).content[0]).toEqual({
      type: "text",
      text: "short",
    });
  });
});
