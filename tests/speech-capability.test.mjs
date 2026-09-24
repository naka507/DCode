import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { readFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("speech IPC is on the typed whitelist and renderer API", async () => {
  const [protocol, api, registerSrc] = await Promise.all([
    read("../src/shared/protocol.ts"),
    read("../src/renderer/lib/api.ts"),
    read("../src/main/ipc/register.ts"),
  ]);
  assert.match(protocol, /speechTranscribe: "dcode\/speech\/transcribe"/);
  assert.match(protocol, /speechSynthesize: "dcode\/speech\/synthesize"/);
  assert.match(protocol, /speechGetStatus: "dcode\/speech\/getStatus"/);
  assert.match(api, /IPC\.invoke\.speechGetStatus/);
  assert.match(api, /IPC\.invoke\.speechTranscribe/);
  assert.match(api, /validateSpeechSettings/);
  assert.match(registerSrc, /registerSpeechIpc/);
});

test("the AI tab renders no speech surface but keeps the host capability", async () => {
  // ADR 0291: the Voice card was the last renderer surface of the host speech
  // capability, and the product does not want a speech configuration surface
  // in Settings. The capability itself stays — plugins and direct IPC callers
  // are its customers — so the protocol contract is asserted right here.
  const [settingsPage, search, styles, en, zh, protocol] = await Promise.all([
    read("../src/renderer/pages/SettingsPage.vue"),
    read("../src/renderer/lib/settings-search.ts"),
    read("../src/renderer/styles/settings.css"),
    read("../src/i18n/locales/en/index.ts"),
    read("../src/i18n/locales/zh-CN/index.ts"),
    read("../src/shared/protocol.ts"),
  ]);
  assert.doesNotMatch(settingsPage, /VoiceSettingsCard|voice-settings/);
  assert.doesNotMatch(search, /settings\.speech/);
  assert.doesNotMatch(styles, /\.settings-speech/);
  // Both shipped catalogs, not just `en`: the reference case reads one catalog
  // because it ships eight, and a partial edit here would otherwise pass.
  for (const [locale, catalog] of [["en", en], ["zh-CN", zh]]) {
    assert.doesNotMatch(
      catalog,
      /speechTitle:|speechVoicePlaceholder:|transcribeFailed:|speakSaved:/,
      `${locale} still carries speech copy`,
    );
  }
  assert.match(protocol, /speechTranscribe: "dcode\/speech\/transcribe"/);
});


test("settings reject an illegal speech protocol id", async () => {
  const { validateSpeechSettings } = await import("@dcode/shared");
  assert.throws(
    () =>
      validateSpeechSettings({
        transcribe: { providerId: "p", modelId: "m", protocol: "OpenAI Audio" },
      }),
    /protocol is invalid/,
  );
});

function speechHarness({ transcribeProtocol = "openai_audio", synthesizeProtocol } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "pi-speech-svc-"));
  test.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const scratch = join(dataDir, "scratch", "sess");
  const host = {
    call: async (method) => {
      if (method === "settings.get") {
        return {
          speech: {
            transcribe: { providerId: "p", modelId: "whisper-1", protocol: transcribeProtocol },
            ...(synthesizeProtocol
              ? { synthesize: { providerId: "p", modelId: "tts-1", protocol: synthesizeProtocol } }
              : {}),
          },
        };
      }
      if (method === "providers.get") {
        return { provider: { id: "p", baseUrl: "https://api.openai.com/v1", enabled: true } };
      }
      if (method === "providers.getSecret") return { value: "sk" };
      if (method === "session.getScratchPath") return { path: scratch };
      throw new Error(method);
    },
  };
  return { dataDir, scratch, host };
}

test("speech-service keeps transcription inside session scratch", async () => {
  const { createSpeechService } = await import("../src/main/services/speech-service.ts");
  const { dataDir, host } = speechHarness();
  const outside = join(dataDir, "outside.wav");
  writeFileSync(outside, "RIFF");
  const speech = createSpeechService({
    dataDir,
    getHost: () => host,
    plugins: { listSpeechAdapters: () => [], getSpeechAdapter: () => undefined, runSpeechAdapter: async () => ({}) },
    logger: { app() {} },
  });
  await assert.rejects(
    () => speech.transcribe({ sessionId: "sess", path: outside }),
    (error) => error.errorCode === "INVALID_ARGUMENT",
  );
  await assert.rejects(
    () => speech.transcribe({ path: outside }),
    (error) => error.errorCode === "INVALID_ARGUMENT",
  );
});

test("speech-service rejects a protocol that cannot transcribe", async () => {
  const { createSpeechService } = await import("../src/main/services/speech-service.ts");
  const { dataDir, scratch, host } = speechHarness({ transcribeProtocol: "openai_chat_audio" });
  const speech = createSpeechService({
    dataDir,
    getHost: () => host,
    plugins: { listSpeechAdapters: () => [], getSpeechAdapter: () => undefined, runSpeechAdapter: async () => ({}) },
    logger: { app() {} },
  });
  await assert.rejects(
    () => speech.transcribe({ sessionId: "sess", path: join(scratch, "a.wav") }),
    (error) => error.errorCode === "SPEECH_PROTOCOL_UNSUPPORTED",
  );
});
