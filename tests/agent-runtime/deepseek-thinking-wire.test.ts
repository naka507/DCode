import { describe, expect, it } from "vitest";
import { buildProviderModel, createProviderModels, type RuntimeProviderConfig } from "../../src/agent/runtime/provider-binding.js";
import { genericModelConfig } from "../../src/agent/runtime/model-capabilities.js";
import { omitThinkingModel } from "../../src/agent/runtime/thinking-level.js";

async function payload(level: "off" | "low" | "medium" | "high" | "omit", override: Partial<RuntimeProviderConfig> = {}) {
  const baseUrl = "https://fixture.invalid/v1";
  const provider: RuntimeProviderConfig = {
    id: "uuid", name: "Gateway", vendorKey: "openai_compatible", apiKey: "fixture",
    baseUrl, modelId: "deepseek-v4.1-flash", apiStyle: "openai-chat",
    supportsReasoning: true, supportedThinkingLevels: ["off", "low", "medium", "high"],
    modelConfig: { ...genericModelConfig("deepseek-v4.1-flash", baseUrl), reasoning: true },
    ...override,
  };
  const model = buildProviderModel(provider);
  const models = createProviderModels(provider, model);
  let sent: Record<string, unknown> | undefined;
  const options = {
    maxRetries: 0,
    fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ error: { message: "fixture stops after capture" } }), { status: 400, headers: { "content-type": "application/json" } });
    },
  };
  const context = { messages: [{ role: "user" as const, content: "hello", timestamp: 1 }] };
  const stream = level === "omit"
    ? models.stream(omitThinkingModel(model), context, options)
    : models.streamSimple(model, context, { ...options, ...(level !== "off" ? { reasoning: level } : {}) });
  await stream.result();
  return sent;
}

describe("custom DeepSeek gateway thinking payload", () => {
  it("sends disabled for off and enabled for high", async () => {
    expect(await payload("off")).toMatchObject({ thinking: { type: "disabled" } });
    expect(await payload("high")).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "high" });
  });
  it("keeps omit free of synthesized reasoning fields", async () => {
    const sent = await payload("omit");
    expect(sent).not.toHaveProperty("thinking");
    expect(sent).not.toHaveProperty("reasoning_effort");
  });
  it.each(["low", "medium", "high"] as const)("sends the requested %s effort", async (level) => {
    expect(await payload(level)).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: level });
  });
  it("preserves an explicit thinking format", async () => {
    const sent = await payload("off", { modelConfig: {
      ...genericModelConfig("deepseek-v4.1-flash", "https://fixture.invalid/v1"), reasoning: true,
      compat: { thinkingFormat: "qwen" },
    } });
    expect(sent).not.toHaveProperty("thinking");
  });
  it("does not infer a custom protocol for named aggregators", async () => {
    expect(await payload("off", { vendorKey: "siliconflow-cn" })).not.toHaveProperty("thinking");
  });
  it("preserves an explicit off mapping", async () => {
    const sent = await payload("off", { modelConfig: {
      ...genericModelConfig("deepseek-v4.1-flash", "https://fixture.invalid/v1"), reasoning: true,
      thinkingLevelMap: { off: "none" },
    } });
    expect(sent).toHaveProperty("reasoning_effort", "none");
    expect(sent).not.toHaveProperty("thinking");
  });
});
