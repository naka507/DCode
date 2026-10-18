/**
 * ADR-006: the pi-adapter seam re-exports pi-* types and wraps functions.
 */
import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  estimateContextTokens,
  convertToLlm,
  serializeConversation,
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  PI_PACKAGES,
  PI_PINNED_VERSION,
  type AgentMessage,
  type Usage,
} from "../../src/agent/pi-adapter/index.js";

describe("pi-adapter", () => {
  it("exposes the pinned pi-* packages and version", () => {
    expect(PI_PACKAGES).toContain("@earendil-works/pi-agent-core");
    expect(PI_PINNED_VERSION).toBe("0.85.1");
  });

  it("wraps token estimation", () => {
    const message = {
      role: "user",
      content: [{ type: "text", text: "hello world, this is a test" }],
    } as unknown as AgentMessage;
    const tokens = estimateTokens(message);
    expect(typeof tokens).toBe("number");
    expect(tokens).toBeGreaterThan(0);
  });

  it("wraps message conversion", () => {
    const message = {
      role: "user",
      content: [{ type: "text", text: "hi" }],
    } as unknown as AgentMessage;
    const llm = convertToLlm([message]);
    expect(Array.isArray(llm)).toBe(true);
  });

  it("wraps summary message builders", () => {
    // Builders accept their pi-native args; the adapter is transparent.
    expect(typeof createBranchSummaryMessage).toBe("function");
    expect(typeof createCompactionSummaryMessage).toBe("function");
    expect(typeof serializeConversation).toBe("function");
    expect(typeof estimateContextTokens).toBe("function");
  });

  it("re-exports types", () => {
    const usage: Usage = {
      input: 1,
      output: 2,
      total: 3,
    } as Usage;
    expect(usage.total).toBe(3);
  });
});
