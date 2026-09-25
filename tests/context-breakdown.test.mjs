import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContextBreakdownSnapshot,
  isMcpOrPluginTool,
  measureAgentMessageChars,
  measureToolSchemaChars,
  formatBreakdownPercent,
} from "../src/agent/runtime/context-breakdown.ts";

test("isMcpOrPluginTool classifies builtin tools as false and external tools as true", () => {
  assert.equal(isMcpOrPluginTool("Read"), false);
  assert.equal(isMcpOrPluginTool("Write"), false);
  assert.equal(isMcpOrPluginTool("Edit"), false);
  assert.equal(isMcpOrPluginTool("Bash"), false);
  assert.equal(isMcpOrPluginTool("Glob"), false);
  assert.equal(isMcpOrPluginTool("Grep"), false);
  assert.equal(isMcpOrPluginTool("Ask"), false);
  assert.equal(isMcpOrPluginTool("Task"), false);
  assert.equal(isMcpOrPluginTool("Skill"), false);

  assert.equal(isMcpOrPluginTool("mcp_postgres_query"), true);
  assert.equal(isMcpOrPluginTool("Mcp_search"), true);
  assert.equal(isMcpOrPluginTool("plugin_weather"), true);
  assert.equal(isMcpOrPluginTool("custom_database_inspect"), true);
  assert.equal(isMcpOrPluginTool("ext_github_issue"), true);
});

test("measureToolSchemaChars and measureAgentMessageChars measure characters correctly", () => {
  const tool = {
    name: "Read",
    description: "Read file contents",
    parameters: { type: "object", properties: { path: { type: "string" } } },
    execute: async () => ({}),
  };
  const chars = measureToolSchemaChars(tool);
  assert.ok(chars > 0);

  const msg = {
    role: "user",
    content: "Hello world!",
  };
  assert.equal(measureAgentMessageChars(msg), 12);

  const complexMsg = {
    role: "assistant",
    content: [
      { type: "text", text: "Answer" },
      { type: "thinking", thinking: "My thought process" },
      { type: "toolCall", name: "Read", args: { path: "foo.txt" } },
    ],
  };
  assert.ok(measureAgentMessageChars(complexMsg) > 0);
});

test("buildContextBreakdownSnapshot allocates tokens proportionally with exact conservation", () => {
  const systemPromptText = "You are DCode, an AI programming assistant.";
  const skills = [
    {
      id: "plugin.git/commit",
      name: "Git commit skill",
      description: "Creates clean git commits",
    },
  ];
  const activeTools = [
    {
      name: "Read",
      description: "Read file",
      parameters: { type: "object" },
      execute: async () => ({}),
    },
    {
      name: "mcp_db_query",
      description: "Run SQL query on remote DB",
      parameters: { type: "object" },
      execute: async () => ({}),
    },
  ];
  const messages = [
    { role: "user", content: "Please query the users table and summarize." },
  ];
  const usage = {
    inputTokens: 1000,
    outputTokens: 200,
    reasoningTokens: 50,
    totalTokens: 1200,
  };

  const breakdown = buildContextBreakdownSnapshot({
    systemPromptText,
    skills,
    activeTools,
    messages,
    usage,
    nextThinking: "Analyzing user request...",
  });

  const byKey = Object.fromEntries(breakdown.map((item) => [item.key, item]));

  // Total occupancy = 1000 + 200 = 1200
  const sumTokens = breakdown.reduce((acc, item) => acc + item.tokens, 0);
  assert.equal(sumTokens, 1200);

  // Every category has appropriate allocation
  assert.ok(byKey.systemPrompt.tokens > 0);
  assert.ok(byKey.skills.tokens > 0);
  assert.ok(byKey.systemTools.tokens > 0);
  assert.ok(byKey.mcp.tokens > 0);
  assert.ok(byKey.messages.tokens > 0);
  assert.equal(byKey.reasoning.tokens, 50);

  // Percentages sum close to 100%
  const sumPercent = breakdown.reduce((acc, item) => acc + item.percent, 0);
  assert.ok(Math.abs(sumPercent - 100) < 0.1);
});

test("buildContextBreakdownSnapshot accurately reflects thinking tokens when reported or estimated", () => {
  const snapshotWithUsage = buildContextBreakdownSnapshot({
    systemPromptText: "System prompt",
    messages: [{ role: "user", content: "Hi" }],
    usage: {
      inputTokens: 100,
      outputTokens: 80,
      reasoningTokens: 60,
      totalTokens: 180,
    },
  });
  const reasoningItem = snapshotWithUsage.find((i) => i.key === "reasoning");
  assert.equal(reasoningItem?.tokens, 60);

  const snapshotWithThinkingEstimate = buildContextBreakdownSnapshot({
    systemPromptText: "System prompt",
    messages: [{ role: "user", content: "Hi" }],
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    },
    nextThinking: "A".repeat(60), // estimated 20 tokens
  });
  const estimatedReasoningItem = snapshotWithThinkingEstimate.find(
    (i) => i.key === "reasoning",
  );
  assert.equal(estimatedReasoningItem?.tokens, 20);
});

test("formatBreakdownPercent formats integers and decimals cleanly", () => {
  assert.equal(formatBreakdownPercent(0), "0%");
  assert.equal(formatBreakdownPercent(5), "5%");
  assert.equal(formatBreakdownPercent(5.5), "5.5%");
  assert.equal(formatBreakdownPercent(5.54), "5.5%");
  assert.equal(formatBreakdownPercent(5.56), "5.6%");
});
