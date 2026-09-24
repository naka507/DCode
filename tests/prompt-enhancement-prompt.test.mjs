/**
 * Mirror of `tests/agent-runtime/prompt-enhancement.test.ts`, the vitest copy
 * that `npm run test:unit` now runs. Each `it(...)` there is one `test(...)`
 * here with the same expectations; assertions are translated from vitest
 * matchers to `node:assert/strict`, and this copy is what `npm test` executes.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
const {
  PROMPT_ENHANCEMENT_DEFAULT_SYSTEM_PROMPT,
  PROMPT_ENHANCEMENT_DEFAULT_USER_TEMPLATE,
} = await import("../src/shared/index.ts");
const {
  enhancePromptDraft,
  promptEnhancementContext,
  stripEnhancementDecorations,
  stripWrappingQuotes,
} = await import("../src/agent/runtime/prompt-enhancement.ts");

const provider = {
  id: "provider",
  name: "Provider",
  modelId: "model",
  apiKey: "test-key",
  apiStyle: "chat_completions",
  supportsReasoning: true,
  supportedThinkingLevels: ["off", "high"],
};

function assistantMessage(content, stopReason = "stop") {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "provider",
    model: "model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function streamFor(message) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      stream.push({
        type: "error",
        reason: message.stopReason,
        error: message,
      });
    } else {
      stream.push({ type: "start", partial: message });
      stream.push({
        type: "done",
        reason: message.stopReason,
        message,
      });
    }
    stream.end(message);
  });
  return stream;
}

test("builds a single system-plus-user context without history or tools", () => {
  const context = promptEnhancementContext("  Make this clearer.  ");
  assert.equal(context.systemPrompt, PROMPT_ENHANCEMENT_DEFAULT_SYSTEM_PROMPT);
  assert.equal(context.messages.length, 1);
  assert.equal(context.messages[0].role, "user");
  assert.equal(context.tools, undefined);
});

test("uses the stored user template and the built-in system prompt", () => {
  const context = promptEnhancementContext("draft text", {
    customTemplate: true,
    userTemplate: "custom {{draft}} template",
  });
  assert.equal(context.systemPrompt, PROMPT_ENHANCEMENT_DEFAULT_SYSTEM_PROMPT);
  assert.equal(context.messages[0].role, "user");
  assert.equal(context.messages[0].content, "custom draft text template");
});

test("keeps the default template while the switch is off", () => {
  const context = promptEnhancementContext("draft text", {
    customTemplate: false,
    userTemplate: "custom {{draft}} template",
  });
  const content = String(context.messages[0].content);
  assert.ok(content.includes("<draft>"));
  assert.ok(!content.includes("custom"));
});

test("ignores a stored template that lost the draft variable", () => {
  const context = promptEnhancementContext("draft text", {
    customTemplate: true,
    userTemplate: "no placeholder",
  });
  assert.equal(context.messages[0].role, "user");
  assert.ok(String(context.messages[0].content).includes("draft text"));
});

test("uses the mocked provider stream, passes reasoning, and trims text output", async () => {
  let seenContext;
  let seenReasoning;
  const enhanced = await enhancePromptDraft(provider, "Rewrite this", "high", {
    stream: (_model, context, options) => {
      seenContext = context;
      seenReasoning = options?.reasoning;
      return streamFor(assistantMessage([{ type: "text", text: "  Rewritten draft  " }]));
    },
  });
  assert.equal(enhanced, "Rewritten draft");
  assert.equal(seenContext?.messages.length, 1);
  assert.equal(seenReasoning, "high");
});

test("strips a wrapping quotation pair from the model answer", async () => {
  const enhanced = await enhancePromptDraft(provider, "Keep this", "off", {
    stream: () =>
      streamFor(
        assistantMessage([{ type: "text", text: '"请解释这段代码的主要功能与边界情况。"' }]),
      ),
  });
  assert.equal(enhanced, "请解释这段代码的主要功能与边界情况。");
});

test("rejects an empty model response without changing the caller's draft", async () => {
  await assert.rejects(
    enhancePromptDraft(provider, "Keep this", "off", {
      stream: () => streamFor(assistantMessage([{ type: "text", text: "  " }])),
    }),
    (error) => {
      assert.equal(error.errorCode, "PROMPT_ENHANCEMENT_EMPTY");
      return true;
    },
  );
});

test("classifies provider failures with the existing error code", async () => {
  await assert.rejects(
    enhancePromptDraft(provider, "Keep this", "off", {
      stream: () =>
        streamFor(
          Object.assign(assistantMessage([], "error"), {
            errorMessage: "401: invalid api key",
          }),
        ),
    }),
    (error) => {
      assert.equal(error.errorCode, "PROVIDER_UNAUTHORIZED");
      return true;
    },
  );
});

test("removes a matching wrapping pair in every supported style", () => {
  assert.equal(stripWrappingQuotes('"clearer"'), "clearer");
  assert.equal(stripWrappingQuotes("'clearer'"), "clearer");
  assert.equal(stripWrappingQuotes("\u201Cclearer\u201D"), "clearer");
  assert.equal(stripWrappingQuotes("\u2018clearer\u2019"), "clearer");
  assert.equal(stripWrappingQuotes('  "clearer"  '), "clearer");
});

test("keeps quotes that are part of the text", () => {
  assert.equal(stripWrappingQuotes('"a" and "b"'), '"a" and "b"');
  assert.equal(stripWrappingQuotes("'it's fine'"), "'it's fine'");
  assert.equal(stripWrappingQuotes('"unmatched'), '"unmatched');
  assert.equal(stripWrappingQuotes("unmatched'"), "unmatched'");
  assert.equal(stripWrappingQuotes("\u201Cunmatched"), "\u201Cunmatched");
});

test("keeps a lone quote or an empty pair without crashing", () => {
  assert.equal(stripWrappingQuotes('"'), '"');
  assert.equal(stripWrappingQuotes('""'), '""');
  assert.equal(stripWrappingQuotes(""), "");
  assert.equal(stripWrappingQuotes("   "), "");
});

test("returns unquoted text unchanged", () => {
  assert.equal(stripWrappingQuotes("  plain text  "), "plain text");
});

test("strips a leading rewrite label after unquoting", () => {
  assert.equal(stripEnhancementDecorations("Enhanced: fix the login bug"), "fix the login bug");
  assert.equal(stripEnhancementDecorations('"Output: 请审查这段代码"'), "请审查这段代码");
  assert.equal(stripEnhancementDecorations("增强：请说明要处理的对象"), "请说明要处理的对象");
});

test("leaves a prompt that is not a label prefix unchanged", () => {
  assert.equal(
    stripEnhancementDecorations("Fix the login bug: identify the path."),
    "Fix the login bug: identify the path.",
  );
});
