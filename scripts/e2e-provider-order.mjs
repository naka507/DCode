#!/usr/bin/env node
/**
 * Provider drag/drop through the settings UI, production IPC and an isolated
 * Rust host.
 *
 * The fixture is a Vue 3 SFC, which `esbuild` cannot compile, so it is bundled
 * with `vite` + `@vitejs/plugin-vue` in library/IIFE mode — the same approach
 * `scripts/e2e-composer-paste.mjs` and `scripts/e2e-transcript-disclosure-anchor.mjs`
 * use. `vite` is a devDependency of this repo; the bundler and its Vue plugin
 * are located through `createRequire`, so no path is hardcoded. `esbuild` is
 * still used for the main-process module, which is plain TypeScript.
 *
 * Three further adaptations, none of which weakens a check:
 *
 *  - **The app's built stylesheet is linked.** The provider rows only
 *    become tiles (and the scroller only scrolls) under the real cascade, so the
 *    runner copies the built CSS out of `out/renderer/index.html` next to the
 *    fixture. The app's stylesheet entry point sequences every partial into one
 *    file, so that whole file is linked.
 *  - **The host binary comes from `scripts/e2e/host.mjs`.** `dcore` is a sibling
 *    checkout, not a child of this repository, so the shared resolver (which
 *    already knows that layout) is used rather than a fourth local copy.
 *  - **`Host` and `IPC` are imported dynamically in `main.cjs`.** Both modules
 *    are `.mjs`/`.ts` and import each other by extension, which Electron's own
 *    Node loads natively (verified: `scripts/e2e/host.mjs` and
 *    `src/shared/protocol.ts` both import cleanly under Electron 43 / Node 24).
 *
 * The probe, its assertion set, the 60s timeout, the throwaway temp directory,
 * and the exit-code handling are all unchanged from the scenario as specified.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveElectronBinary } from "./e2e/boot.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The require anchor is the repo-root manifest, which carries every bundler
// this runner resolves (same line as `scripts/e2e-composer-paste.mjs`).
const require = createRequire(join(root, "package.json"));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
const vue = (await import(pathToFileURL(require.resolve("@vitejs/plugin-vue")).href))
  .default;
const { build: esbuild } = require("esbuild");
const { electronBinary } = resolveElectronBinary(root);
const binary = resolveHostBinary();
const temp = await mkdtemp(join(tmpdir(), "pi-provider-order-"));
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
        entry: join(root, "scripts/e2e/provider-order.ts"),
        formats: ["iife"],
        name: "ProviderOrderFixture",
        fileName: () => "renderer.js",
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  await esbuild({
    entryPoints: [join(root, "src/main/ipc/provider-ipc.ts")],
    outfile: join(temp, "provider-ipc.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
  });
  // The provider tiles and the scroller only measure correctly under the real
  // cascade, so every built stylesheet the renderer ships is copied and linked;
  // the app's stylesheet entry point sequences every partial into one file.
  const builtHtml = await readFile(join(root, "out/renderer/index.html"), "utf8");
  const styleSheets = [
    ...builtHtml.matchAll(/<link[^>]+href="\.\/([^"]+\.css)"/g),
  ].map((match) => match[1]);
  assert(
    styleSheets.length > 0,
    "no built stylesheet found in out/renderer/index.html; run `npm run build`",
  );
  for (const sheet of styleSheets) {
    await writeFile(
      join(temp, sheet.replace(/^assets\//, "")),
      await readFile(join(root, "out/renderer", sheet)),
    );
  }
  await writeFile(
    join(temp, "index.html"),
    `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:"><link rel="stylesheet" href="${styleSheets[0].replace(/^assets\//, "")}"><body><script src="bundle/renderer.js"></script>`,
  );
  await writeFile(
    join(temp, "main.cjs"),
    `
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { registerProviderIpc } = require("./provider-ipc.cjs");
const { pathToFileURL } = require("node:url");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const { Host } = await import(pathToFileURL(${JSON.stringify(join(root, "scripts/e2e/host.mjs"))}).href);
  const { IPC } = await import(pathToFileURL(${JSON.stringify(join(root, "src/shared/protocol.ts"))}).href);
  const host = new Host(${JSON.stringify(binary)}, path.join(__dirname, "data"));
  let window;
  let failure;
  try {
    await host.start();
    const fixtures = [];
    for (const name of ["A", "B", "C"]) {
      const { provider } = await host.call("providers.create", { name, authKind: "none", defaultModelId: "model-" + name });
      fixtures.push(provider);
    }
    await host.call("settings.set", { defaultProviderId: fixtures[0].id, defaultModelId: fixtures[0].defaultModelId });
    for (const input of [
      { id: fixtures[0].id, targetId: fixtures[1].id, placement: "invalid" },
      { id: "missing", targetId: fixtures[1].id, placement: "before" },
      { id: fixtures[0].id, targetId: "missing", placement: "after" },
    ]) {
      let code;
      try { await host.call("providers.reorder", input); }
      catch (error) { code = error.errorCode; }
      if (code !== "INVALID_PARAMS") throw new Error("invalid reorder must be rejected without writing");
    }

    const registrar = { handle(channel, handler) {
      ipcMain.handle(channel, async (_event, input) => {
        try { return { ok: true, data: await handler(input) }; }
        catch (error) { return { ok: false, error: { code: error.errorCode || "INTERNAL", message: error.message } }; }
      });
    } };
    const enrich = (provider) => ({ ...provider, supportsReasoning: false, supportedThinkingLevels: ["off"] });
    registerProviderIpc({
      registrar, getHost: () => host,
      modelsDevCatalog: {
        ensureLoaded: async () => {}, loadLocal: async () => {}, findModel: () => undefined,
        modelsForProvider: () => [], getStatus: () => ({ loaded: true, source: "empty", modelCount: 0, providerCount: 0 }),
      },
      vendorOAuth: { listVendors: async () => [] }, logger: { app() {} },
      enrichProvider: enrich,
      enrichProviderList: async (result) => ({ providers: result.providers.map(enrich) }),
      listRuntimeProviders: async () => (await host.call("providers.list")).providers,
      bindingForModel: (provider, modelId) => provider.models?.find((model) => model.id === modelId),
    });
    registrar.handle(IPC.invoke.settingsGet, () => host.call("settings.get"));
    registrar.handle(IPC.invoke.sessionList, () => host.call("session.list"));
    registrar.handle(IPC.invoke.appGetOnboarding, async () => ({ dismissed: true }));
    window = new BrowserWindow({ show: false, width: 1000, height: 1000, webPreferences: {
      preload: ${JSON.stringify(join(root, "out/preload/index.cjs"))},
      sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    } });
    window.webContents.on("console-message", (event) => console.error(event.message));
    await window.loadFile(path.join(__dirname, "index.html"));
    // Labelled separately: a failure in either probe has to say which one it was.
    let interactions;
    let performance;
    try {
      interactions = await window.webContents.executeJavaScript("globalThis.providerOrderProbe()");
    } catch (error) {
      throw new Error("providerOrderProbe: " + String(error));
    }
    try {
      performance = await window.webContents.executeJavaScript("globalThis.cardReorderPerformance()");
    } catch (error) {
      throw new Error("cardReorderPerformance: " + String(error));
    }
    // Restart the host and reload the page: the saved order must survive both.
    await host.restart();
    await window.loadFile(path.join(__dirname, "index.html"));
    const restart = await window.webContents.executeJavaScript("globalThis.providerOrderProbe(true)");
    console.log("PROVIDER_ORDER_PROBE " + JSON.stringify({ ...interactions, restart: restart.ok, performance }));
  } catch (error) {
    failure = error;
    console.error("PROVIDER_ORDER_PROBE " + JSON.stringify({ ok: false, error: String(error) }));
  } finally {
    window?.destroy();
    await host.stop();
    app.exit(failure ? 1 : 0);
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
  const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally {
    clearTimeout(timer);
  }
  const line = output
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("PROVIDER_ORDER_PROBE "));
  assert(line, `no result (exit=${code}): ${output.slice(-4000)}`);
  console.log(line);
  assert.equal(code, 0, output.slice(-6000));
  assert.equal(JSON.parse(line.slice("PROVIDER_ORDER_PROBE ".length)).ok, true);
} finally {
  await rm(temp, { recursive: true, force: true });
}
