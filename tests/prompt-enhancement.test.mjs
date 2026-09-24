import { readMainSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PROMPT_ENHANCEMENT_TIMEOUT_MS,
  withPromptEnhancementTimeout,
} from "../src/main/prompt-enhancement-timeout.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [composer, api, main, protocol, runtime, oneShot, en, zh] =
  await Promise.all([
    read("../src/renderer/features/chat/composer/hooks/useComposerSubmit.ts"),
    read("../src/renderer/lib/api.ts"),
    readMainSource(),
    read("../src/shared/protocol.ts"),
    read("../src/agent/runtime/prompt-enhancement.ts"),
    read("../src/agent/runtime/one-shot-complete.ts"),
    read("../src/i18n/locales/en/index.ts"),
    read("../src/i18n/locales/zh-CN/index.ts"),
  ]);
test("prompt enhancement uses the typed main-process bridge", () => {
  assert.match(protocol, /promptEnhance: "dcode\/prompt\/enhance"/);
  assert.match(api, /enhancePrompt: \(req: PromptEnhancementRequest\)/);
  assert.match(api, /IPC\.invoke\.promptEnhance/);
  assert.match(main, /handle\(IPC\.invoke\.promptEnhance/);
  assert.match(main, /enhancePromptDraft\(/);
  // The handler bounds the request through the dedicated timeout module.
  assert.match(main, /withPromptEnhancementTimeout/);
  assert.match(main, /from "\.\.\/prompt-enhancement-timeout"/);
  assert.match(main, /withPromptEnhancementTimeout\(\(signal\) =>/);
  assert.match(main, /signal,/);
  assert.match(main, /sessionId: launchSessionId/);
  assert.match(main, /resolveAuth: \(\) => vendorOAuth\.resolveAuth/);
  assert.match(runtime, /completeOneShot\(/);
  assert.match(oneShot, /createProviderRetryStream/);
  assert.match(oneShot, /models\.streamSimple/);
  assert.match(oneShot, /withOpenCodeSessionHeaders/);
});

test("prompt enhancement has complete English-first locale coverage", () => {
  for (const source of [en, zh]) {
    assert.match(source, /enhancePrompt:/);
    assert.match(source, /enhancingPrompt:/);
    assert.match(source, /undoEnhancement:/);
    assert.match(source, /enhancementFailed:/);
    assert.match(source, /enhancementTimeout:/);
    assert.match(source, /dismissEnhancementError:/);
  }
});

test("the Composer shows the timeout copy rather than the raw provider error", () => {
  assert.match(composer, /typed\.code === "TIMEOUT"/);
  assert.match(composer, /t\("chat\.enhancementTimeout"\)/);
  assert.match(composer, /t\("chat\.enhancementFailed"\)/);
});

test("an enhancement request is released when the provider never answers", async () => {
  const started = Date.now();
  // A promise that never settles is exactly the hang the transport cannot bound
  // on its own: the abort signal is only consulted between provider retries.
  const never = new Promise(() => {});
  let seenSignal;
  await assert.rejects(
    withPromptEnhancementTimeout((signal) => {
      seenSignal = signal;
      return never;
    }, 40),
    (error) => {
      assert.equal(error.errorCode, "TIMEOUT");
      assert.match(error.message, /timed out after/);
      return true;
    },
  );
  assert.equal(seenSignal?.aborted, true, "timeout must abort the in-flight request");
  assert.ok(Date.now() - started < 2000, "the caller must be released promptly");
});

test("a completed enhancement is not turned into a timeout", async () => {
  assert.equal(
    await withPromptEnhancementTimeout(() => Promise.resolve("ok"), 5000),
    "ok",
  );
  await assert.rejects(
    withPromptEnhancementTimeout(() => Promise.reject(new Error("provider 500")), 5000),
    /provider 500/,
  );
});

test("the default ceiling is about a minute", () => {
  assert.equal(PROMPT_ENHANCEMENT_TIMEOUT_MS, 60_000);
});
