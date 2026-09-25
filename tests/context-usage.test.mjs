import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateToolTokenUsage,
  calculateCacheRate,
  calculateTokenRate,
  calculateContextUsage,
  contextOccupancyTokens,
  contextUsageView,
  estimateResponseOutputTokens,
  estimateToolTokenUsage,
  resolveContextUsageDisplay,
  resolveContextWindow,
  toolTokenUsage,
  usageTokenTotal,
  settleStoppedAssistantMetrics,
  formatContextCapacityTokens,
  calculateContextBreakdown,
} from "../src/renderer/lib/context-usage.ts";

test("context usage exposes the remaining ring percentage", () => {
  const context = calculateContextUsage(
    {
      inputTokens: 80,
      outputTokens: 20,
      totalTokens: 100,
    },
    128,
  );

  assert.equal(context.usedTokens, 100);
  assert.equal(context.remainingTokens, 28);
  assert.equal(context.usedPercent, 78);
  assert.equal(context.remainingPercent, 22);
  assert.equal(context.remainingRatio, 28 / 128);
});

test("context usage display preference picks the ring's leading figure", () => {
  const context = calculateContextUsage(
    { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
    128,
  );

  const remaining = contextUsageView(context, "remaining");
  assert.equal(remaining.percent, 22);
  assert.equal(remaining.tokens, 28);
  assert.equal(remaining.ratio, 28 / 128);

  const used = contextUsageView(context, "used");
  assert.equal(used.percent, 78);
  assert.equal(used.tokens, 100);
  assert.equal(used.ratio, 100 / 128);
});

test("an absent or unrecognised display value keeps the remaining default", () => {
  assert.equal(resolveContextUsageDisplay(undefined), "remaining");
  assert.equal(resolveContextUsageDisplay("used"), "used");
  assert.equal(resolveContextUsageDisplay("remaining"), "remaining");
  assert.equal(resolveContextUsageDisplay("bogus"), "remaining");
  assert.equal(resolveContextUsageDisplay(null), "remaining");
});

test("context window prefers the selected model catalog over provider fallback", () => {
  const providerModels = {
    provider: [
      {
        modelId: "catalog-model",
        displayName: "Catalog model",
        providerId: "provider",
        contextWindow: 256_000,
        capabilities: ["text"],
        source: "discovered",
      },
      {
        modelId: "gpt-5.6-luna",
        displayName: "GPT-5.6 Luna",
        providerId: "provider",
        contextWindow: 1_050_000,
        capabilities: ["text"],
        source: "discovered",
      },
    ],
  };
  const providers = [
    {
      id: "provider",
      contextWindow: 64_000,
      models: [
        {
          id: "gpt-5.6-luna",
          contextWindow: 128_000,
          maxTokens: 8_192,
          thinkingLevels: [],
        },
      ],
    },
  ];

  assert.equal(
    resolveContextWindow("provider", "catalog-model", providerModels, providers),
    256_000,
  );
  assert.equal(
    resolveContextWindow("provider", "gpt-5.6-luna", providerModels, providers),
    1_050_000,
  );
  assert.equal(
    resolveContextWindow("provider", "unknown-model", providerModels, providers),
    64_000,
  );
});

test("context window uses the selected binding before the model list loads", () => {
  const providers = [
    {
      id: "provider",
      contextWindow: 128_000,
      models: [
        {
          id: "gpt-5.6-luna",
          contextWindow: 1_050_000,
          maxTokens: 128_000,
          thinkingLevels: [],
        },
      ],
    },
  ];

  assert.equal(
    resolveContextWindow("provider", "gpt-5.6-luna", {}, providers),
    1_050_000,
  );
});

test("context usage falls back to input and output when total is absent", () => {
  assert.equal(
    usageTokenTotal({ inputTokens: 12, outputTokens: 8, totalTokens: 0 }),
    20,
  );
});

test("occupancy uses provider totalTokens without double-counting cache or reasoning", () => {
  const usage = {
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 80,
    cacheWriteTokens: 2,
    reasoningTokens: 3,
    totalTokens: 15,
  };
  assert.equal(contextOccupancyTokens(usage), 15);
  assert.equal(calculateContextUsage(usage, 200).usedTokens, 15);
  assert.equal(usageTokenTotal(usage), 15);
});

test("occupancy falls back to inputTokens + outputTokens when totalTokens is 0", () => {
  const usage = {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 0,
  };
  assert.equal(contextOccupancyTokens(usage), 15);
  assert.equal(calculateContextUsage(usage, 200).usedTokens, 15);
});

test("generation throughput uses provider output and stream duration", () => {
  assert.equal(calculateTokenRate(1_200, 4_000), 300);
  assert.equal(calculateTokenRate(0, 4_000), undefined);
  assert.equal(calculateTokenRate(1_200, undefined), undefined);
});

test("stopped responses get immediate estimated output and duration metadata", () => {
  const message = {
    id: "assistant-1",
    role: "assistant",
    content: "Partial answer",
    thinking: "Reasoning",
    createdAt: "2026-08-11T00:00:00.000Z",
    status: "streaming",
  };
  assert.equal(estimateResponseOutputTokens(message), 6);
  assert.deepEqual(
    settleStoppedAssistantMetrics(message, Date.parse("2026-08-11T00:00:02.500Z")),
    {
      ...message,
      responseDurationMs: 2_500,
      responseOutputTokens: 6,
    },
  );
});

test("cache rate measures cached prompt tokens against the full prompt", () => {
  assert.equal(calculateCacheRate(100, 300), 75);
  assert.equal(calculateCacheRate(100, 0), 0);
  assert.equal(calculateCacheRate(0, 100), 100);
  assert.equal(calculateCacheRate(100, undefined), undefined);
  assert.equal(calculateCacheRate(0, 0), undefined);
});

test("tool usage exposes argument and result estimates", () => {
  const message = {
    id: "tool-1",
    role: "tool",
    content: "result text",
    createdAt: new Date().toISOString(),
    toolName: "read",
    toolArgs: { path: "src/index.ts" },
    toolResult: { content: [{ type: "text", text: "result text" }] },
  };
  const usage = estimateToolTokenUsage(message);

  assert.ok(usage.argumentTokens > 0);
  assert.ok(usage.resultTokens > 0);
  assert.equal(usage.totalTokens, usage.argumentTokens + usage.resultTokens);
  assert.equal(usage.estimated, true);
  assert.deepEqual(toolTokenUsage({ ...message, toolUsage: usage }), usage);
});

test("tool usage aggregates repeated calls in first-seen order", () => {
  const messages = [
    {
      id: "tool-1",
      role: "tool",
      content: "first result",
      createdAt: new Date().toISOString(),
      toolName: "read",
      toolUsage: {
        argumentTokens: 10,
        resultTokens: 20,
        totalTokens: 30,
        estimated: true,
      },
      toolDurationMs: 100,
    },
    {
      id: "tool-2",
      role: "tool",
      content: "second result",
      createdAt: new Date().toISOString(),
      toolName: "bash",
      toolUsage: {
        argumentTokens: 4,
        resultTokens: 6,
        totalTokens: 10,
        estimated: true,
      },
      toolDurationMs: 250,
    },
    {
      id: "tool-3",
      role: "tool",
      content: "third result",
      createdAt: new Date().toISOString(),
      toolName: "read",
      toolUsage: {
        argumentTokens: 7,
        resultTokens: 13,
        totalTokens: 20,
        estimated: true,
      },
      toolDurationMs: 300,
    },
  ];

  assert.deepEqual(aggregateToolTokenUsage(messages), [
    {
      toolName: "read",
      callCount: 2,
      argumentTokens: 17,
      resultTokens: 33,
      totalTokens: 50,
      durationMs: 400,
      estimated: true,
    },
    {
      toolName: "bash",
      callCount: 1,
      argumentTokens: 4,
      resultTokens: 6,
      totalTokens: 10,
      durationMs: 250,
      estimated: true,
    },
  ]);
});

test("formatContextCapacityTokens formats tokens in Chinese and English locales", () => {
  assert.equal(formatContextCapacityTokens(0, "zh-CN"), "0");
  assert.equal(formatContextCapacityTokens(343_000, "zh-CN"), "34.3万");
  assert.equal(formatContextCapacityTokens(1_000_000, "zh-CN"), "100万");
  assert.equal(formatContextCapacityTokens(128_000, "zh-CN"), "12.8万");
  assert.equal(formatContextCapacityTokens(8_000, "zh-CN"), "8000");

  assert.equal(formatContextCapacityTokens(0, "en"), "0");
  assert.equal(formatContextCapacityTokens(343_000, "en"), "343K");
  assert.equal(formatContextCapacityTokens(1_000_000, "en"), "1M");
  assert.equal(formatContextCapacityTokens(800, "en"), "800");
});

test("calculateContextBreakdown groups tools, prompt, messages, and computes percentages", () => {
  const tools = [
    {
      id: "1",
      role: "tool",
      content: "",
      createdAt: "",
      toolName: "Bash",
      toolUsage: { argumentTokens: 50, resultTokens: 130, totalTokens: 180, estimated: true },
    },
    {
      id: "2",
      role: "tool",
      content: "",
      createdAt: "",
      toolName: "skill_read_docs",
      toolUsage: { argumentTokens: 2, resultTokens: 4, totalTokens: 6, estimated: true },
    },
    {
      id: "3",
      role: "tool",
      content: "",
      createdAt: "",
      toolName: "mcp_browser_click",
      toolUsage: { argumentTokens: 1, resultTokens: 2, totalTokens: 3, estimated: true },
    },
  ];

  const breakdown = calculateContextBreakdown({
    usage: {
      inputTokens: 900,
      outputTokens: 100,
      totalTokens: 1000,
    },
    tools,
    systemPromptTokens: 7,
  });

  const byKey = Object.fromEntries(breakdown.map((item) => [item.key, item]));

  // Total occupancy = 1000
  // systemTools: 180 -> 18%
  // skills: 6 -> 0.6%
  // mcp: 3 -> 0.3%
  // systemPrompt: 7 -> 0.7%
  // messages: 1000 - 180 - 6 - 3 - 7 = 804 -> 80.4%
  // other: 0 -> 0%
  assert.equal(byKey.systemTools.tokens, 180);
  assert.equal(byKey.systemTools.formattedPercent, "18%");
  assert.equal(byKey.skills.tokens, 6);
  assert.equal(byKey.skills.formattedPercent, "0.6%");
  assert.equal(byKey.mcp.tokens, 3);
  assert.equal(byKey.mcp.formattedPercent, "0.3%");
  assert.equal(byKey.systemPrompt.tokens, 7);
  assert.equal(byKey.systemPrompt.formattedPercent, "0.7%");
  assert.equal(byKey.messages.tokens, 804);
  assert.equal(byKey.messages.formattedPercent, "80.4%");
  assert.equal(byKey.reasoning.tokens, 0);
  assert.equal(byKey.reasoning.formattedPercent, "0%");
  assert.equal(byKey.other.tokens, 0);
  assert.equal(byKey.other.formattedPercent, "0%");
});

test("calculateContextBreakdown separates reasoning tokens from messages", () => {
  const breakdown = calculateContextBreakdown({
    usage: {
      inputTokens: 1000,
      outputTokens: 200,
      reasoningTokens: 800,
      totalTokens: 2000,
    },
    tools: [
      {
        id: "1",
        role: "tool",
        content: "",
        createdAt: "",
        toolName: "Read",
        toolUsage: { argumentTokens: 50, resultTokens: 150, totalTokens: 200, estimated: true },
      },
    ],
    systemPromptTokens: 100,
  });

  const byKey = Object.fromEntries(breakdown.map((item) => [item.key, item]));

  // Total occupancy = 1000 + 200 + 800 = 2000
  // systemTools: 200 -> 10%
  // systemPrompt: 100 -> 5%
  // reasoning: 800 -> 40%
  // messages: 2000 - 200 - 100 - 800 = 900 -> 45%
  assert.equal(byKey.systemTools.tokens, 200);
  assert.equal(byKey.systemTools.formattedPercent, "10%");
  assert.equal(byKey.systemPrompt.tokens, 100);
  assert.equal(byKey.systemPrompt.formattedPercent, "5%");
  assert.equal(byKey.reasoning.tokens, 800);
  assert.equal(byKey.reasoning.formattedPercent, "40%");
  assert.equal(byKey.messages.tokens, 900);
  assert.equal(byKey.messages.formattedPercent, "45%");
});

test("calculateContextBreakdown passes through backend-computed contextBreakdown directly", () => {
  const mockBackendBreakdown = [
    {
      key: "messages",
      labelKey: "chat.usageBreakdownMessages",
      colorClass: "dot-messages",
      tokens: 500,
      chars: 2000,
      percent: 50,
      formattedPercent: "50%",
    },
    {
      key: "reasoning",
      labelKey: "chat.usageBreakdownReasoning",
      colorClass: "dot-reasoning",
      tokens: 200,
      chars: 800,
      percent: 20,
      formattedPercent: "20%",
    },
    {
      key: "systemTools",
      labelKey: "chat.usageBreakdownSystemTools",
      colorClass: "dot-system-tools",
      tokens: 150,
      chars: 600,
      percent: 15,
      formattedPercent: "15%",
    },
    {
      key: "systemPrompt",
      labelKey: "chat.usageBreakdownSystemPrompt",
      colorClass: "dot-system-prompt",
      tokens: 100,
      chars: 400,
      percent: 10,
      formattedPercent: "10%",
    },
    {
      key: "skills",
      labelKey: "chat.usageBreakdownSkills",
      colorClass: "dot-skills",
      tokens: 30,
      chars: 120,
      percent: 3,
      formattedPercent: "3%",
    },
    {
      key: "mcp",
      labelKey: "chat.usageBreakdownMcp",
      colorClass: "dot-mcp",
      tokens: 20,
      chars: 80,
      percent: 2,
      formattedPercent: "2%",
    },
  ];

  const result = calculateContextBreakdown({
    usage: { inputTokens: 800, outputTokens: 200, totalTokens: 1000 },
    contextBreakdown: mockBackendBreakdown,
  });

  assert.deepEqual(result, mockBackendBreakdown);
});

