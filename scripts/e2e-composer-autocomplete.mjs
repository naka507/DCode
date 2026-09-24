#!/usr/bin/env node
/**
 * Real Chromium layout regression for the composer slash menu (E2E-088b).
 *
 * The fixture is a Vue 3 SFC, which `esbuild` cannot compile, so it is bundled
 * with `vite` + `@vitejs/plugin-vue` in library/IIFE mode. `vite` is a
 * devDependency of this repo (`esbuild` only arrives transitively); the plugin
 * and the bundler are located through `createRequire`, so no path is hardcoded.
 *
 * The probe, its assertion set, the 45s timeout, the throwaway temp directory,
 * and the exit-code handling are all unchanged from the scenario as specified.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { resolveElectronBinary } from "./e2e/boot.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The require anchor is the repo-root manifest, which carries the bundler this
// runner resolves (same line as `scripts/e2e-rpc-unicode.mjs`).
const require = createRequire(join(root, "package.json"));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
const vue = (await import(pathToFileURL(require.resolve("@vitejs/plugin-vue")).href))
  .default;
const { electronBinary } = resolveElectronBinary(root);
const temp = await mkdtemp(join(tmpdir(), "pi-autocomplete-layout-"));
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
        entry: join(root, "scripts/e2e/composer-autocomplete-layout.ts"),
        formats: ["iife"],
        name: "AutocompleteLayoutFixture",
        fileName: () => "renderer.js",
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  // Use the built app's complete CSS, including the Tailwind reset.
  const renderer = join(root, "out/renderer");
  const appHtml = await readFile(join(renderer, "index.html"), "utf8");
  const css = [...appHtml.matchAll(/href="([^" ]+\.css)"/g)].map((match) => match[1]);
  assert(css.length, "Build the app with npm run build before running this check");
  await cp(join(renderer, "assets"), join(temp, "assets"), { recursive: true });
  await writeFile(join(temp, "index.html"), `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:"><title>Composer autocomplete layout</title>${css.map((path) => `<link rel="stylesheet" href="${path}">`).join("")}<body><script src="bundle/renderer.js"></script>`);
  await writeFile(
    join(temp, "main.cjs"),
    `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1040, height: 760, webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.on("console-message", (event) => console.error(event.message));
  try {
    await window.loadFile(path.join(__dirname, "index.html"));
    const checks = [];
    for (const [viewport, width] of [[1040, 320], [1680, 640]]) {
      window.setContentSize(viewport, 760);
      for (const fileMode of [false, true]) {
        checks.push(await window.webContents.executeJavaScript("globalThis.autocompleteLayoutProbe(" + width + "," + fileMode + ")"));
        if (process.env.PI_E2E_ARTIFACT_DIR) {
          const fs = require("node:fs");
          fs.mkdirSync(process.env.PI_E2E_ARTIFACT_DIR, { recursive: true });
          fs.writeFileSync(path.join(process.env.PI_E2E_ARTIFACT_DIR, "autocomplete-" + width + "-" + fileMode + ".png"), (await window.webContents.capturePage()).toPNG());
        }
      }
    }
    console.log("AUTOCOMPLETE_LAYOUT_PROBE " + JSON.stringify({ ok: checks.every((check) => check.ok), checks }));
    app.quit();
  } catch (error) {
    console.error("AUTOCOMPLETE_LAYOUT_PROBE " + JSON.stringify({ ok: false, error: String(error) }));
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
    .find((line) => line.startsWith("AUTOCOMPLETE_LAYOUT_PROBE "));
  assert(
    line,
    `renderer returned no probe result (exit=${code}): ${output.slice(-2000)}`,
  );
  const result = JSON.parse(line.slice("AUTOCOMPLETE_LAYOUT_PROBE ".length));
  console.log("AUTOCOMPLETE_LAYOUT_PROBE " + JSON.stringify(result));
  assert.equal(code, 0, output.slice(-6000));
  assert.equal(result.ok, true);
} finally {
  await rm(temp, { recursive: true, force: true });
}
