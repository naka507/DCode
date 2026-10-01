import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { SubagentRun } from "../../src/agent/runtime/subagent.js";
import type { RuntimeProviderConfig } from "../../src/agent/runtime/provider-binding.js";

type Request = {
  messages: Array<{ role: string; content: unknown }>;
};

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** OpenAI-compatible endpoint that records every request and always finishes. */
async function fixture() {
  const requests: Request[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const request = JSON.parse(raw) as Request & { model: string };
    requests.push(request);
    const base = { id: "fixture", object: "chat.completion.chunk", created: 1, model: request.model };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Report." }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing fixture address");
  const provider: RuntimeProviderConfig = {
    id: "primary", name: "primary", modelId: "primary",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "fixture", authKind: "api_key_and_base_url", apiStyle: "openai-chat",
    supportsReasoning: false, supportedThinkingLevels: ["off"],
  };
  return { provider, requests };
}

const usage = {
  input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** One earlier `Read` call and its bulky result, as a long delegate run accumulates them. */
function readExchange(index: number): AgentMessage[] {
  const id = `read-${index}`;
  return [
    {
      role: "assistant",
      content: [{ type: "toolCall", id, name: "Read", arguments: { path: `src/file-${index}.ts` } }],
      api: "openai-completions", provider: "primary", model: "primary",
      usage, stopReason: "toolUse", timestamp: index,
    },
    {
      role: "toolResult",
      toolCallId: id,
      toolName: "Read",
      content: [{ type: "text", text: `contents of file ${index}\n${"x".repeat(500)}` }],
      isError: false,
      timestamp: index,
    },
  ] as AgentMessage[];
}

function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (part as { text?: string }).text ?? "").join("");
  }
  return "";
}

describe("SubagentRun model context", () => {
  it("retains historical tool results in the request without premature clearing", async () => {
    const { provider, requests } = await fixture();
    const exchanges = 7;
    const initialMessages: AgentMessage[] = [
      { role: "user", content: "Map the module.", timestamp: 0 } as AgentMessage,
      ...Array.from({ length: exchanges }, (_, index) => readExchange(index + 1)).flat(),
    ];
    const run = new SubagentRun({
      definition: { name: "researcher", description: "Fixture", tools: ["Read"], prompt: "Report.", source: "builtin" },
      sessionId: "s", parentToolCallId: "task", task: "Continue and report.", systemPrompt: "Report.",
      provider, thinkingLevel: "off", tools: [], initialMessages,
      onEvent: () => {},
    });

    const result = await run.run();

    expect(result.status).toBe("completed");
    expect(requests).toHaveLength(1);
    const toolResults = requests[0].messages
      .filter((message) => message.role === "tool")
      .map((message) => text(message.content));
    expect(toolResults).toHaveLength(exchanges);
    // All tool results must be retained intact to preserve the subagent's working memory
    toolResults.forEach((resultText, offset) => {
      expect(resultText).toContain(`contents of file ${offset + 1}`);
    });
    // The call arguments survive as well
    expect(JSON.stringify(requests[0].messages)).toContain("src/file-1.ts");
  });

  it("leaves the delegate's own state untouched", async () => {
    const { provider } = await fixture();
    const initialMessages: AgentMessage[] = [
      { role: "user", content: "Map the module.", timestamp: 0 } as AgentMessage,
      ...Array.from({ length: 7 }, (_, index) => readExchange(index + 1)).flat(),
    ];
    const run = new SubagentRun({
      definition: { name: "researcher", description: "Fixture", tools: ["Read"], prompt: "Report.", source: "builtin" },
      sessionId: "s", parentToolCallId: "task", task: "Continue and report.", systemPrompt: "Report.",
      provider, thinkingLevel: "off", tools: [], initialMessages,
      onEvent: () => {},
    });

    await run.run();

    const state = (run as unknown as { agent: { state: { messages: AgentMessage[] } } }).agent.state.messages;
    const kept = state
      .filter((message) => message.role === "toolResult")
      .map((message) => text((message as { content: unknown }).content));
    expect(kept.every((result) => result.startsWith("contents of file"))).toBe(true);
  });
});
