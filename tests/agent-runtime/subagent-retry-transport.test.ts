import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { Type } from "typebox";
import { SubagentRun, type SubagentProviderRetry } from "../../src/agent/runtime/subagent.js";
import { PROVIDER_RATE_LIMIT_MAX_RETRIES, PROVIDER_TRANSIENT_MAX_RETRIES } from "../../src/agent/runtime/provider-retry.js";

type Step = "tool" | "report" | "stream-error" | number;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

/** Real adapter and agent loop; only the remote provider is replaced. */
async function fixture(steps: Step[], controller?: AbortController) {
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  let mutations = 0;
  const retries: SubagentProviderRetry[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    const step = steps[Math.min(requests.length - 1, steps.length - 1)];
    if (typeof step === "number") {
      if (controller) res.on("finish", () => controller.abort());
      res.writeHead(step, { "content-type": "application/json", "retry-after": controller ? "60" : "0" });
      res.end(JSON.stringify({ error: { message: `Fixture HTTP ${step}: private-provider-body` } }));
      return;
    }
    const base = { id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture" };
    const delta = step === "tool"
      ? { role: "assistant", tool_calls: [{ index: 0, id: `edit-${requests.length}`, type: "function", function: { name: "Edit", arguments: "{}" } }] }
      : { role: "assistant", content: "Completed with retained work." };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    if (step === "stream-error") {
      res.end(`data: ${JSON.stringify({ error: { message: "terminated private-provider-body", type: "server_error", code: "server_error" } })}\n\n`);
      return;
    }
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: step === "tool" ? "tool_calls" : "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const run = new SubagentRun({
    definition: { name: "worker", description: "Fixture", tools: ["Edit"], prompt: "Finish.", source: "user" },
    sessionId: "session", parentToolCallId: "task", task: "Finish.", systemPrompt: "Finish.",
    provider: {
      id: "fixture", name: "Fixture", modelId: "fixture", apiKey: "fixture",
      baseUrl: `http://127.0.0.1:${address.port}/v1`, apiStyle: "openai-chat",
      supportsReasoning: false, supportedThinkingLevels: ["off"],
    },
    thinkingLevel: "off", signal: controller?.signal,
    tools: [{
      name: "Edit", label: "Edit", description: "Save work.", parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: `Saved ${++mutations}` }], details: {} }),
    }],
    onEvent: () => {},
    onProviderRetry: (retry) => retries.push(retry),
  });
  return { run, requests, retries, mutations: () => mutations };
}

describe("subagent retry across successful requests", () => {
  it("cancels a rate-limited request without replaying completed tools", async () => {
    const controller = new AbortController();
    const f = await fixture(["tool", 429], controller);
    const result = await f.run.run();
    expect(result.status).toBe("aborted");
    expect(f.requests).toHaveLength(2);
    expect(f.mutations()).toBe(1);
  });
  it.each([429, 503])("recovers from isolated HTTP %i failures without replaying tools", async (status) => {
    const steps: Step[] = [];
    for (let i = 0; i < 12; i++) steps.push("tool", status);
    steps.push("report");
    const f = await fixture(steps);
    const result = await f.run.run();
    expect(result.status).toBe("completed");
    expect(result.report).toContain("Completed with retained work.");
    expect(f.mutations()).toBe(12);
    expect(result.toolCalls).toBe(12);
    expect(f.requests).toHaveLength(25);
    expect(f.requests.at(-1)?.messages.filter((m) => m.role === "tool")).toHaveLength(12);
    expect(f.retries).toHaveLength(12);
    for (const retry of f.retries) {
      expect(retry).toEqual({
        code: status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_ERROR",
        providerStatus: status, phase: "request", attempt: 1,
        maxAttempts: status === 429 ? PROVIDER_RATE_LIMIT_MAX_RETRIES : PROVIDER_TRANSIENT_MAX_RETRIES,
        delayMs: 0,
      });
    }
    expect(JSON.stringify(f.retries)).not.toContain("private-provider-body");
    for (let i = 1; i < 24; i += 2) {
      expect(f.requests[i + 1].messages).toEqual(f.requests[i].messages);
    }
  });

  it("reports stream recovery without reporting HTTP 200 as an error or replaying a tool", async () => {
    const f = await fixture(["tool", "stream-error", "report"]);
    const result = await f.run.run();
    expect(result.status).toBe("completed");
    expect(f.mutations()).toBe(1);
    expect(f.retries).toHaveLength(1);
    expect(f.retries[0]).toMatchObject({ phase: "stream", attempt: 1, maxAttempts: PROVIDER_TRANSIENT_MAX_RETRIES });
    expect(f.retries[0]).not.toHaveProperty("providerStatus");
    expect(JSON.stringify(f.retries)).not.toContain("private-provider-body");
  });

  it.each([429, 503])("still stops after consecutive HTTP %i failures exhaust the budget", async (status) => {
    const f = await fixture(["tool", status]);
    const result = await f.run.run();
    const retries = status === 429 ? PROVIDER_RATE_LIMIT_MAX_RETRIES : PROVIDER_TRANSIENT_MAX_RETRIES;
    expect(result.status).toBe("failed");
    expect(f.requests).toHaveLength(retries + 2);
    expect(f.mutations()).toBe(1);
  });
});
