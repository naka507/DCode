#!/usr/bin/env node
/**
 * Real Chromium regression for E2E-083's stable completed activity groups.
 *
 * The three drivers are Vue 3 SFCs, which `esbuild` cannot compile, so they
 * are bundled with `vite` + `@vitejs/plugin-vue` in library/IIFE mode — the
 * same approach `scripts/e2e-transcript-disclosure-anchor.mjs`,
 * `e2e-composer-paste.mjs` and `e2e-composer-autocomplete.mjs` use. `vite`,
 * the plugin and the bundler are located through `createRequire`, so no path
 * is hardcoded.
 *
 * The render-count instrumentation is the one part that needs care, and it is
 * worth stating plainly. A Vue SFC has no source marker whose body runs once
 * per render: `<script setup>` compiles to a `setup()` that runs once per
 * mount, and the per-render work is the arrow function it returns. So the
 * counter is injected at that arrow instead: `return (_ctx, _cache) => {`,
 * which the compiler emits exactly once per SFC and which is asserted to occur
 * exactly once, so a compiler change fails here rather than silently counting
 * nothing.
 *
 * What that counter then has to agree with is the identity contract, and this
 * app keeps it somewhere else. Vue compares a child's props shallowly
 * (`Object.is` per prop), so a fresh `items` array would re-render all 100
 * groups on every token — measured, not assumed: 2000 renders across the 20
 * text updates. The guarantee is `reuseTranscriptEntries`
 * (`src/renderer/lib/assistant-turns.ts`), which `useTranscriptScroll` calls to
 * keep identity for unchanged rows; with it the same loop renders 0 times. The
 * fixture therefore routes its entries through that function, exactly as the
 * app does. The assertion still fails loudly (2000 !== 0) if that guarantee
 * regresses.
 *
 * The `.transcript-runtime-status` source-vs-built drift check: the
 * runtime-slot scenario measures geometry against the built stylesheet, so a
 * stale build has to fail here rather than pass a geometry check against CSS
 * that no longer describes the source.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { assertDesktopBuild, resolveElectronBinary } from "./e2e/boot.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The require anchor is the repo-root manifest, which carries every bundler
// this runner resolves (same line as `scripts/e2e-transcript-disclosure-anchor.mjs`).
const require = createRequire(join(root, "package.json"));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
const vue = (await import(pathToFileURL(require.resolve("@vitejs/plugin-vue")).href))
  .default;
assertDesktopBuild(root);
const { electronBinary } = resolveElectronBinary(root);

/**
 * Count one render per `ActivityGroup` render function invocation.
 *
 * The marker is the compiler's own output for the returned render arrow. The
 * group's first item message id is pushed, so a scenario can assert *which*
 * group re-rendered, not just how many times something did.
 */
function countActivityGroupRenders() {
  return {
    name: "count-activity-group-renders",
    enforce: "post",
    transform(code, id) {
      if (!(id.includes("ActivityGroup.vue") && id.includes("type=script"))) {
        return null;
      }
      const marker = "return (_ctx, _cache) => {";
      assert.equal(
        code.split(marker).length,
        2,
        "ActivityGroup instrumentation boundary changed",
      );
      return code.replace(
        marker,
        `${marker}\n      (globalThis.__activityGroupRenders ??= []).push(props.items[0]?.message.id);`,
      );
    },
  };
}

const temp = await mkdtemp(join(tmpdir(), "pi-transcript-render-"));
try {
  await build({
    root,
    logLevel: "warn",
    configFile: false,
    mode: "production",
    plugins: [countActivityGroupRenders(), vue()],
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
        entry: join(root, "scripts/e2e/transcript-render.ts"),
        formats: ["iife"],
        name: "TranscriptRenderFixture",
        fileName: () => "renderer.js",
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });

  // The runtime-status scenario measures real geometry, so the page needs the
  // app's built stylesheet: the Tailwind reset, the design tokens (the
  // indicator's own type scale), and the transcript layers live there.
  const renderer = join(root, "out", "renderer");
  const appHtml = await readFile(join(renderer, "index.html"), "utf8");
  const css = [...appHtml.matchAll(/href="([^" ]+\.css)"/g)].map(
    (match) => match[1],
  );
  assert(
    css.length,
    "Build the app with npm run build before running this check",
  );
  await cp(join(renderer, "assets"), join(temp, "assets"), { recursive: true });
  // The scenario measures a rule that only exists in the built stylesheet, so a
  // stale build must fail loudly instead of passing against an older CSS file.
  const laneSource = await readFile(
    join(root, "src/renderer/styles/chat-shell.css"),
    "utf8",
  );
  // Comments inside the rule describe intent; only its declarations are compared.
  const laneRule = laneSource
    .match(/\.transcript-runtime-status \{([\s\S]*?)\}/)?.[1]
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert(
    laneRule,
    "chat-shell.css declares no .transcript-runtime-status rule",
  );
  const builtCss = (
    await Promise.all(css.map((path) => readFile(join(renderer, path), "utf8")))
  )
    .join("\n")
    .replace(/\s+/g, "");
  const builtRule = builtCss.match(
    /\.transcript-runtime-status\{([^}]*)\}/,
  )?.[1];
  assert(
    builtRule,
    "the built stylesheet predates the runtime status lane; build with npm run build",
  );
  // The scenario measures a rule that lives in the built stylesheet, so the two
  // copies have to agree: a build still carrying a declaration the source has
  // dropped (or missing one the source added) must fail here rather than pass a
  // geometry check against CSS that no longer describes the source.
  const declarations = (rule) =>
    new Set(rule.replace(/\s+/g, "").split(";").filter(Boolean));
  const sourceDeclarations = declarations(laneRule);
  const builtDeclarations = declarations(builtRule);
  const drift = [
    ...[...builtDeclarations].filter((value) => !sourceDeclarations.has(value)),
    ...[...sourceDeclarations].filter((value) => !builtDeclarations.has(value)),
  ];
  assert(
    drift.length === 0,
    `the built stylesheet is stale (${drift.join(", ")}); build with npm run build`,
  );
  await writeFile(
    join(temp, "index.html"),
    `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:"><title>Transcript render regression</title>${css
      .map((path) => `<link rel="stylesheet" href="${path}">`)
      .join("")}<script src="bundle/renderer.js"></script>`,
  );
  await writeFile(
    join(temp, "main.cjs"),
    `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on("console-message", (event) => console.error(event.message));
  try {
    await window.loadFile(path.join(__dirname, "index.html"));
    const result = await window.webContents.executeJavaScript("globalThis.transcriptRenderProbe().then((render) => globalThis.transcriptRuntimeSlotProbe().then((slot) => Object.assign({}, render, { runtimeSlot: slot, ok: render.ok && slot.ok })))");
    console.log("TRANSCRIPT_RENDER_PROBE " + JSON.stringify(result));
    app.quit();
  } catch (error) {
    console.error("TRANSCRIPT_RENDER_PROBE " + JSON.stringify({ ok: false, error: String(error) }));
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
    .find((line) => line.startsWith("TRANSCRIPT_RENDER_PROBE "));
  assert(
    line,
    `renderer returned no probe result (exit=${code}): ${output.slice(-2000)}`,
  );
  const result = JSON.parse(line.slice("TRANSCRIPT_RENDER_PROBE ".length));
  console.log("TRANSCRIPT_RENDER_PROBE " + JSON.stringify(result));
  assert.equal(code, 0, output.slice(-6000));
  assert.equal(result.ok, true);
  // The merged result above already carries the geometry snapshots; this turns
  // a failed scenario into a message that names the checks that failed.
  assert.equal(
    result.runtimeSlot?.ok,
    true,
    `runtime status slot scenario failed: ${JSON.stringify(result.runtimeSlot?.failures)}`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
