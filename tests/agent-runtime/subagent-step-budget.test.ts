import { describe, expect, it } from "vitest";
import { SubagentRun, defaultSubagentMaxSteps } from "../../src/agent/runtime/subagent.js";
import type { RuntimeProviderConfig } from "../../src/agent/runtime/provider-binding.js";

const provider: RuntimeProviderConfig = {
  id: "primary",
  name: "primary",
  modelId: "primary",
  baseUrl: "http://127.0.0.1:9999/v1",
  apiKey: "fixture",
  authKind: "api_key_and_base_url",
  apiStyle: "openai-chat",
  supportsReasoning: false,
  supportedThinkingLevels: ["off"],
};

describe("Subagent step budget & loop breaker", () => {
  it("provides sensible default maxSteps per role", () => {
    expect(defaultSubagentMaxSteps("researcher")).toBe(15);
    expect(defaultSubagentMaxSteps("tester")).toBe(15);
    expect(defaultSubagentMaxSteps("reviewer")).toBe(10);
    expect(defaultSubagentMaxSteps("coder")).toBe(25);
    expect(defaultSubagentMaxSteps("designer")).toBe(25);
    expect(defaultSubagentMaxSteps("unknown-role")).toBe(20);
  });

  it("detects repeated identical tool calls and injects warning at 3 and aborts at 5", async () => {
    const run = new SubagentRun({
      definition: {
        name: "researcher",
        description: "Fixture",
        tools: ["Read"],
        prompt: "Report.",
        source: "builtin",
      },
      sessionId: "s",
      parentToolCallId: "task",
      task: "Search.",
      systemPrompt: "Report.",
      provider,
      thinkingLevel: "off",
      tools: [],
      onEvent: () => {},
    });

    const createCall = (id: string) => ({
      toolCall: { id, name: "Read" },
      args: { path: "src/same-file.ts" },
      result: { content: [{ type: "text" as const, text: "content" }] },
      isError: false,
    });

    // Calls 1 and 2: no loop detected
    expect(await (run as any).afterToolCall(createCall("c1"))).toBeUndefined();
    expect(await (run as any).afterToolCall(createCall("c2"))).toBeUndefined();

    // Call 3: warning injected
    const result3 = await (run as any).afterToolCall(createCall("c3"));
    expect(result3).toBeDefined();
    expect(result3.terminate).toBeUndefined();
    expect(result3.isError).toBeUndefined();
    expect(JSON.stringify(result3.content)).toContain("Repeated identical tool call detected");

    // Call 4: continues to warn if still repeating
    const result4 = await (run as any).afterToolCall(createCall("c4"));
    expect(result4).toBeDefined();
    expect(result4.terminate).toBeUndefined();
    expect(JSON.stringify(result4.content)).toContain("Repeated identical tool call detected");

    // Call 5: loop breaker triggers abort
    const result5 = await (run as any).afterToolCall(createCall("c5"));
    expect(result5).toBeDefined();
    expect(result5.terminate).toBe(true);
    expect(result5.isError).toBe(true);
    expect(JSON.stringify(result5.content)).toContain("Loop Breaker: Aborting tool loop");
  });

  it("warns when approaching step budget and terminates when budget reached", async () => {
    const run = new SubagentRun({
      definition: {
        name: "tester",
        description: "Fixture",
        tools: ["Bash"],
        prompt: "Report.",
        source: "builtin",
        maxSteps: 10,
      },
      sessionId: "s",
      parentToolCallId: "task",
      task: "Test.",
      systemPrompt: "Report.",
      provider,
      thinkingLevel: "off",
      tools: [],
      onEvent: () => {},
    });

    const createCall = (id: string, step: number) => ({
      toolCall: { id, name: "Bash" },
      args: { command: `run-test-${step}` },
      result: { content: [{ type: "text" as const, text: `output-${step}` }] },
      isError: false,
    });

    // Step 5 of 10: normal
    (run as any).toolCalls = 5;
    expect(await (run as any).afterToolCall(createCall("c5", 5))).toBeUndefined();

    // Step 7 of 10: approaching limit (70%)
    (run as any).toolCalls = 7;
    const result7 = await (run as any).afterToolCall(createCall("c7", 7));
    expect(result7).toBeDefined();
    expect(result7.terminate).toBeUndefined();
    expect(JSON.stringify(result7.content)).toContain("Step budget approaching limit (7/10)");

    // Step 8 of 10: warnedApproachingLimit is already set, so doesn't duplicate notice
    (run as any).toolCalls = 8;
    expect(await (run as any).afterToolCall(createCall("c8", 8))).toBeUndefined();

    // Step 10 of 10: reached maxSteps, terminates loop
    (run as any).toolCalls = 10;
    const result10 = await (run as any).afterToolCall(createCall("c10", 10));
    expect(result10).toBeDefined();
    expect(result10.terminate).toBe(true);
    expect(JSON.stringify(result10.content)).toContain("Maximum step budget reached (10/10)");
  });
});
