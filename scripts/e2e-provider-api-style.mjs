#!/usr/bin/env node
/**
 * Real Chromium coverage for the custom-provider API-format boundary: the new
 * custom form exposes exactly the general formats, a saved account-only format
 * stays visible without becoming a new choice, an explicit protocol change is
 * saved, and a copy neither converts the source protocol nor reuses its
 * identity or credentials.
 *
 * The fixture is a Vue 3 SFC, which `esbuild` cannot compile, so it is bundled
 * with `vite` + `@vitejs/plugin-vue` in library/IIFE mode — the same approach
 * `scripts/e2e-composer-paste.mjs` and
 * `scripts/e2e-transcript-disclosure-anchor.mjs` use. `vite` is a devDependency
 * of this repo; the bundler and its Vue plugin are located through
 * `createRequire`, so no path is hardcoded.
 *
 * The probe, its marker, the assertion set, the 45s timeout, the throwaway
 * temp directory, the sandboxed hidden window, the CSP meta, the
 * `console-message` forwarding and the exit-code handling are all unchanged
 * from the scenario as specified.
 *
 * No host process and no preload: the API boundary is stubbed inside the
 * fixture, so this runner imports `resolveElectronBinary` from the shared
 * `./e2e/boot.mjs` alone.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { resolveElectronBinary } from "./e2e/boot.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The require anchor is the repo-root manifest, which carries every bundler
// this runner resolves (same line as `scripts/e2e-composer-paste.mjs`).
const require = createRequire(join(root, "package.json"));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
const vue = (
  await import(pathToFileURL(require.resolve("@vitejs/plugin-vue")).href)
).default;
const { electronBinary } = resolveElectronBinary(root);
const temp = await mkdtemp(join(tmpdir(), "pi-provider-api-style-"));
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
        entry: join(root, "scripts/e2e/provider-api-style.ts"),
        formats: ["iife"],
        name: "ProviderApiStyleFixture",
        fileName: () => "renderer.js",
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  await writeFile(
    join(temp, "index.html"),
    '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'self\' \'unsafe-inline\'"><title>Provider API format regression</title><body><script src="bundle/renderer.js"></script>',
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
    const result = await window.webContents.executeJavaScript("globalThis.providerApiStyleProbe()");
    console.log("PROVIDER_API_STYLE_PROBE " + JSON.stringify(result));
    app.quit();
  } catch (error) {
    console.error("PROVIDER_API_STYLE_PROBE " + JSON.stringify({ ok: false, error: String(error) }));
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
    .find((line) => line.startsWith("PROVIDER_API_STYLE_PROBE "));
  assert(
    line,
    `renderer returned no probe result (exit=${code}): ${output.slice(-2000)}`,
  );
  const result = JSON.parse(line.slice("PROVIDER_API_STYLE_PROBE ".length));
  console.log("PROVIDER_API_STYLE_PROBE " + JSON.stringify(result));
  assert.equal(code, 0, output.slice(-6000));
  assert.equal(result.ok, true);
} finally {
  await rm(temp, { recursive: true, force: true });
}
