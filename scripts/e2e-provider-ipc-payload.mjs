#!/usr/bin/env node
/**
 * Real-Chromium coverage for the renderer→main payload boundary.
 *
 * The reported bug: saving a new AI service in the Add dialog showed
 * `An object could not be cloned.` That is Chromium's own `DataCloneError`,
 * raised inside `ipcRenderer.invoke` when an argument is a Vue proxy, which
 * `structuredClone` refuses. The save payload carried the live elements of a
 * `ref` array (`bindingsToPersist` returned `binding` itself), so the call threw
 * before any main-process handler ran.
 *
 * Why a new runner rather than an extension of `e2e-provider-api-style.mjs`:
 * that fixture stubs the `api` object, which sits *below* the IPC boundary, and
 * it unwraps proxies with its own `unproxy` helper before calling
 * `structuredClone`. The helper is what hid the bug — it removed the proxies the
 * production code was still sending. This fixture stubs `window.dcode.invoke`
 * instead, so the real `lib/api.ts` runs and the real `structuredClone` sees
 * whatever production code produces.
 *
 * The bundling step, the sandboxed hidden window, the CSP meta, the
 * `console-message` forwarding, the 45s timeout and the exit-code handling are
 * the same as `scripts/e2e-provider-api-style.mjs`.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveElectronBinary } from "./e2e/boot.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
const vue = (
  await import(pathToFileURL(require.resolve("@vitejs/plugin-vue")).href)
).default;
const { electronBinary } = resolveElectronBinary(root);
const temp = await mkdtemp(join(tmpdir(), "pi-provider-ipc-payload-"));
try {
  await build({
    root,
    logLevel: "warn",
    configFile: false,
    mode: "production",
    plugins: [vue()],
    define: { "process.env.NODE_ENV": '"production"' },
    resolve: {
      alias: {
        "@dcode/shared/protocol": join(root, "src/shared/protocol.ts"),
        "@dcode/shared/theme": join(root, "src/shared/theme.ts"),
        "@dcode/shared": join(root, "src/shared/index.ts"),
        "@dcode/i18n": join(root, "src/i18n/index.ts"),
        "@renderer": join(root, "src/renderer"),
        // One Vue instance for the fixture and the components it renders.
        vue: join(root, "node_modules/vue"),
      },
    },
    build: {
      outDir: join(temp, "bundle"),
      emptyOutDir: true,
      minify: false,
      write: true,
      lib: {
        entry: join(root, "scripts/e2e/provider-ipc-payload.ts"),
        formats: ["iife"],
        name: "ProviderIpcPayloadFixture",
        fileName: () => "renderer.js",
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  await writeFile(
    join(temp, "index.html"),
    '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'self\' \'unsafe-inline\'"><title>Provider IPC payload</title><body><script src="bundle/renderer.js"></script>',
  );
  await writeFile(
    join(temp, "main.cjs"),
    `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.on("console-message", (event) => console.error(event.message));
  try {
    await window.loadFile(path.join(__dirname, "index.html"));
    const result = await window.webContents.executeJavaScript("globalThis.providerIpcPayloadProbe()");
    console.log("PROVIDER_IPC_PAYLOAD_PROBE " + JSON.stringify(result));
    app.quit();
  } catch (error) {
    console.error("PROVIDER_IPC_PAYLOAD_PROBE " + JSON.stringify({ ok: false, error: String(error) }));
    app.exit(1);
  }
});
`,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, [join(temp, "main.cjs")], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      output += data;
    });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 45_000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally {
    clearTimeout(timeout);
  }
  const line = output
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("PROVIDER_IPC_PAYLOAD_PROBE "));
  assert(
    line,
    `renderer returned no probe result (exit=${code}): ${output.slice(-2000)}`,
  );
  const result = JSON.parse(line.slice("PROVIDER_IPC_PAYLOAD_PROBE ".length));
  console.log("PROVIDER_IPC_PAYLOAD_PROBE " + JSON.stringify(result));
  assert.equal(code, 0, output.slice(-6000));
  assert.equal(result.ok, true, JSON.stringify(result));
} finally {
  await rm(temp, { recursive: true, force: true });
}
