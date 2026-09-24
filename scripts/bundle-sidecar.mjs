#!/usr/bin/env node
/**
 * Bundle the agent-runtime sidecar into `resources/runtime/`.
 *
 * The bundle is produced with `esbuild` from the agent-runtime package's
 * `bundle` script; the output contract is fixed because three things depend
 * on it:
 *
 *   1. `src/main/agent-sidecar.ts` spawns `agent-runtime/sidecar.js` from
 *      `process.resourcesPath` in a packaged app.
 *   2. electron-builder's `extraResources` copies the whole directory (including
 *      its `package.json`) to `resources/agent-runtime`.
 *   3. The output is ESM (`.js` entry plus an import banner), so Node needs a
 *      sibling `package.json` declaring `"type": "module"` — without it the
 *      bundled file is read as CommonJS and dies on its first `import`.
 *
 * esbuild is invoked through its Node API rather than a shell command so the
 * script behaves identically on Windows, macOS, and Linux.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "src", "agent", "runtime", "sidecar.ts");
const OUT_DIR = join(ROOT, "resources", "runtime");
const OUT_FILE = join(OUT_DIR, "sidecar.js");

/**
 * The banner gives the ESM bundle a CommonJS `require`, which the bundled
 * `jiti` trusted-extension loader reaches for.
 */
const BANNER =
  "import { createRequire as __piCreateRequire } from 'node:module'; " +
  "const require = __piCreateRequire(import.meta.url);";

mkdirSync(OUT_DIR, { recursive: true });

await build({
  entryPoints: [ENTRY],
  outfile: OUT_FILE,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // pi-coding-agent's extension loader picks jiti `virtualModules` only for
  // compiled or bundled Node distributions; every other Node build resolves
  // `typebox` relative to the importing file. A packaged sidecar lives in
  // `resources/agent-runtime/`, which has no `node_modules` above it, so
  // without this define every native Pi extension fails with
  // `Cannot find module 'typebox'` (E2E-245).
  define: { PI_BUNDLED_NODE: "true" },
  banner: { js: BANNER },
  // The sidecar is a separate process launched from `resources/agent-runtime/`,
  // which has no `node_modules` above it and cannot resolve into `app.asar`, so
  // every runtime dependency has to be inlined. `electron` stays external
  // because it is a build-time-only surface this entry never imports.
  external: ["electron"],
  logLevel: "info",
});

// The ESM marker must be written after a successful build, so a failed bundle
// never leaves a package.json that would mislabel a stale sidecar.js.
writeFileSync(
  join(OUT_DIR, "package.json"),
  `${JSON.stringify({ type: "module" }, null, 2)}\n`,
  "utf8",
);

console.log(`sidecar bundle written to ${OUT_FILE}`);
