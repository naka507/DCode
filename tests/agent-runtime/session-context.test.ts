import { describe, expect, it } from "vitest";
import type {
  AgentMessage,
  CompactionEntry,
  MessageEntry,
} from "@earendil-works/pi-agent-core";
import { buildSessionContext } from "../../src/agent/runtime/session-context.js";

function user(id: string, text: string, seq: number): MessageEntry {
  return {
    type: "message",
    id,
    parentId: null,
    seq,
    timestamp: seq,
    message: { role: "user", content: text, timestamp: seq },
  };
}

function assistant(
  id: string,
  text: string,
  seq: number,
  stopReason: "stop" | "error" | "aborted" = "stop",
): MessageEntry {
  return {
    type: "message",
    id,
    parentId: null,
    seq,
    timestamp: seq,
    message: {
      role: "assistant",
      api: "openai-completions",
      provider: "local",
      model: "local",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason,
      timestamp: seq,
      content: [{ type: "text", text }],
    } as AgentMessage,
  };
}

function compaction(
  id: string,
  seq: number,
  tail: AgentMessage[] = [],
): CompactionEntry {
  return {
    type: "compaction",
    id,
    parentId: null,
    seq,
    timestamp: seq,
    summary: "older work",
    tokensBefore: 100,
    retainedTail: tail,
    fromHook: false,
  };
}

describe("buildSessionContext", () => {
  it("passes message entries through and drops failed assistants", () => {
    const messages = buildSessionContext([
      user("u1", "hello", 0),
      assistant("a1", "failed", 1, "error"),
      assistant("a2", "ok", 2),
    ]).messages;
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(
      messages[1] && "content" in messages[1]
        ? (messages[1].content as { text?: string }[])[0]?.text
        : undefined,
    ).toBe("ok");
  });

  it("drops assistants that have no content blocks", () => {
    // D446: an accepted silent completion reply, or any other empty
    // assistant, is not worth resending and would be rejected by providers.
    const empty = assistant("a1", "", 1);
    (empty.message as { content: unknown[] }).content = [];
    const messages = buildSessionContext([
      user("u1", "notice", 0),
      empty,
      user("u2", "next", 2),
      assistant("a2", "answer", 3),
    ]).messages;
    expect(messages.map((message) => message.role)).toEqual(["user", "user", "assistant"]);
  });

  it("slices from the newest compaction and puts the summary before the tail", () => {
    const keptUser = user("u2", "keep me", 3).message;
    const messages = buildSessionContext([
      user("u0", "old", 0),
      assistant("a0", "old answer", 1),
      compaction("c1", 2, [keptUser]),
      user("u3", "next", 3),
    ]).messages;
    expect(messages.map((message) => message.role)).toEqual([
      "compactionSummary",
      "user",
      "user",
    ]);
    expect(JSON.stringify(messages)).toContain("older work");
    expect(JSON.stringify(messages)).toContain("keep me");
    expect(JSON.stringify(messages)).toContain("next");
    expect(JSON.stringify(messages)).not.toContain("old answer");
  });

  it("replays retained reasoning between the summary and the user tail", () => {
    // #296
    const keptUser = user("u2", "keep me", 3).message;
    const entry = compaction("c1", 2, [keptUser]);
    entry.details = {
      retainedReasoning: [{ thinking: "prior plan", text: "prior answer" }],
    };
    const messages = buildSessionContext([
      user("u0", "old", 0),
      assistant("a0", "old answer", 1),
      entry,
      user("u3", "next", 3),
    ]).messages;
    expect(messages.map((message) => message.role)).toEqual([
      "compactionSummary",
      "assistant",
      "user",
      "user",
    ]);
    expect(JSON.stringify(messages)).toContain("prior plan");
    expect(JSON.stringify(messages)).toContain("keep me");
    expect(JSON.stringify(messages)).not.toContain("old answer");
  });

  it("does not replay DeepSeek reasoning into a different provider", () => {
    const keptUser = user("u2", "keep me", 3).message;
    const entry = compaction("c1", 2, [keptUser]);
    entry.details = {
      retainedReasoning: [{ thinking: "prior DeepSeek plan", text: "answer" }],
    };
    const messages = buildSessionContext(
      [entry, user("u3", "next", 4)],
      {
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-opus-4-6",
        requiresCompletionsReasoningReplay: false,
      },
    ).messages;
    expect(messages.map((message) => message.role)).toEqual([
      "compactionSummary",
      "user",
      "user",
    ]);
    expect(JSON.stringify(messages)).not.toContain("prior DeepSeek plan");
  });

  it("silently compacts older tool results beyond keepRecent window", () => {
    function toolResultEntry(id: string, text: string, seq: number): MessageEntry {
      return {
        type: "message",
        id,
        parentId: null,
        seq,
        timestamp: seq,
        message: {
          role: "toolResult",
          toolCallId: `call-${id}`,
          toolName: "ReadFile",
          content: [{ type: "text", text }],
          isError: false,
          timestamp: seq,
        } as AgentMessage,
      };
    }

    const entries: MessageEntry[] = [
      user("u1", "read files", 0),
      toolResultEntry("t1", "old-huge-content-1-".repeat(20), 1),
      toolResultEntry("t2", "old-huge-content-2-".repeat(20), 2),
      toolResultEntry("t3", "recent-content-3-".repeat(20), 3),
      toolResultEntry("t4", "recent-content-4-".repeat(20), 4),
    ];

    const messages = buildSessionContext(entries, undefined, { keepRecent: 2 }).messages;
    expect(messages).toHaveLength(5);
    // t1 and t2 should be cleared
    expect((messages[1] as any).content[0].text).toBe("[Old tool result content cleared]");
    expect((messages[2] as any).content[0].text).toBe("[Old tool result content cleared]");
    // t3 and t4 should be preserved
    expect((messages[3] as any).content[0].text).toContain("recent-content-3");
    expect((messages[4] as any).content[0].text).toContain("recent-content-4");
  });
});
