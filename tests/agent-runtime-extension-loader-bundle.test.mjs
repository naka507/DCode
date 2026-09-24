/**
 * E2E-245 regression for the packaged install (967f3c2c):
 * pi-coding-agent's own extension loader picks jiti `virtualModules` only for
 * compiled or bundled Node distributions. Every other Node build falls back to
 * `require.resolve("typebox")` relative to the importing file. A packaged
 * sidecar lives in `resources/agent-runtime/`, which has no `node_modules`
 * above it, so without the bundled-Node define the sidecar fails every native
 * Pi extension with `Cannot find module 'typebox'`.
 *
 * The same case lives at `tests/agent-runtime/extensions/bundle.test.ts` and
 * runs under `npm run test:unit`; this copy is the one `npm test` runs.
 * The `--define:` flag is read back from the shipped bundle carrier,
 * `scripts/bundle-sidecar.mjs`.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// pi-coding-agent ships an import-only export map, so locate its directory
// through the layout the sidecar bundle resolves from.
const extensionLoader = resolve(
  root,
  "node_modules",
  "@earendil-works/pi-coding-agent",
  "dist",
  "core",
  "extensions",
  "loader.js",
);

/** The esbuild `define:` flags the shipped bundle carrier carries. */
function bundleDefines() {
  const script = readFileSync(resolve(root, "scripts", "bundle-sidecar.mjs"), "utf8");
  const defines = {};
  for (const [, name, value] of script.matchAll(/define:\s*\{\s*([A-Za-z0-9_]+):\s*"(\S+)"/g)) {
    defines[name] = value;
  }
  return defines;
}

test("loads a typebox-importing extension from a bundle outside the repo", async () => {
  assert.ok(existsSync(extensionLoader), "pi-coding-agent's own extension loader is not installed");
  const work = mkdtempSync(join(tmpdir(), "pi-ext-bundle-"));
  try {
    const entry = join(work, "entry.mjs");
    writeFileSync(
      entry,
      `import { createRequire } from "node:module";
import { loadExtensions } from ${JSON.stringify(extensionLoader)};
const [extension] = process.argv.slice(2);
const eventBus = { emit: () => {}, on: () => () => {}, off: () => {} };
const resolvesTypebox = (() => {
  try {
    createRequire(import.meta.url).resolve("typebox");
    return true;
  } catch {
    return false;
  }
})();
const loaded = await loadExtensions([extension], process.cwd(), eventBus, undefined);
process.stdout.write(JSON.stringify({ resolvesTypebox, loaded: loaded.extensions.length, errors: loaded.errors.map((error) => error.error) }));
`,
    );
    // `--platform`, `--format` and the banner are duplicated from the bundle
    // carrier on purpose; only `define:` flags are read back from it, so a
    // future non-define flag in the script has to be mirrored here.
    await build({
      entryPoints: [entry],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: join(work, "sidecar.js"),
      logLevel: "silent",
      define: bundleDefines(),
      banner: {
        js: "import { createRequire as __piCreateRequire } from 'node:module'; const require = __piCreateRequire(import.meta.url);",
      },
    });

    const extension = join(work, "typed.ts");
    writeFileSync(
      extension,
      `import { Type } from "typebox";
export default function (pi: any) {
  pi.registerTool({
    name: "fx_noop",
    description: "no-op",
    parameters: Type.Object({ a: Type.Number() }),
    async execute() {
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
  });
}
`,
    );

    // A test runner exports NODE_PATH into its workers and the child would
    // inherit the repository's node_modules through it. A packaged install has
    // no such fallback, so scrub it before running the bundle under test.
    const childEnv = { ...process.env };
    delete childEnv.NODE_PATH;
    const out = execFileSync(process.execPath, [join(work, "sidecar.js"), extension], {
      cwd: work,
      encoding: "utf8",
      env: childEnv,
    });
    const report = JSON.parse(out);
    assert.deepEqual(report.errors, []);
    assert.equal(report.loaded, 1);
    // The child resolves `typebox` as soon as something above the bundle
    // provides it, and a `TMPDIR` inside the repository does, which would let
    // this case pass without the bundle define.
    assert.equal(report.resolvesTypebox, false, "TMPDIR must lie outside any node_modules tree");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
