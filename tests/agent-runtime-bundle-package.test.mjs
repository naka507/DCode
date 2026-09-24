import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Issue #507: packaged installs copy resources/runtime to
// resources/agent-runtime via electron-builder extraResources. The esbuild
// output is ESM (.js entry + import banner), but Node resolves module type
// from the nearest package.json. Without resources/runtime/package.json declaring
// "type":"module", sidecar.js loads as CommonJS and dies at startup.
//
// dcode carries the bundle as a standalone esbuild JS-API script
// (`scripts/bundle-sidecar.mjs`) rather than as a `bundle` shell script in a
// workspace package, so the bundle contract is read from that file.

const desktopPackageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const bundleScriptSource = await readFile(
  new URL("../scripts/bundle-sidecar.mjs", import.meta.url),
  "utf8",
);

test("desktop packaging ships the whole agent-runtime bundle directory", () => {
  const entry = desktopPackageJson.build.extraResources.find(
    (resource) => resource.to === "agent-runtime",
  );

  assert.deepEqual(
    entry,
    {
      from: "resources/runtime",
      to: "agent-runtime",
    },
    "extraResources must copy resources/runtime (including its package.json) to resources/agent-runtime",
  );
});

test("agent-runtime bundle emits an ESM sidecar entry", () => {
  assert.match(bundleScriptSource, /format:\s*"esm"/);
  assert.match(bundleScriptSource, /outfile:\s*OUT_FILE/);
  assert.match(
    bundleScriptSource,
    /const OUT_FILE = join\(OUT_DIR, "sidecar\.js"\);/,
  );
});

test("agent-runtime bundle writes package.json with type module", () => {
  // The write must follow the build so a successful bundle always produces the
  // ESM marker that electron-builder will ship beside sidecar.js.
  assert.match(bundleScriptSource, /join\(OUT_DIR, "package\.json"\)/);
  assert.match(bundleScriptSource, /JSON\.stringify\(\{ type: "module" \}/);
  assert.ok(
    bundleScriptSource.indexOf('JSON.stringify({ type: "module" }') >
      bundleScriptSource.indexOf("await build({"),
    "the package.json write must follow the esbuild build",
  );
});

test("agent-runtime bundle declares the bundled-Node flag for the kernel extension loader", () => {
  // pi-coding-agent's extension loader embeds typebox and the kernel modules
  // only for compiled or bundled Node distributions. Without the define it
  // resolves them from the importing file, which a packaged install under
  // resources/agent-runtime cannot satisfy, so every native Pi extension fails
  // with "Cannot find module 'typebox'" (see
  // tests/agent-runtime-extension-loader-bundle.test.mjs for the behavior).
  assert.match(
    bundleScriptSource,
    /define:\s*\{\s*PI_BUNDLED_NODE:\s*"true"\s*\}/,
    "bundle must define PI_BUNDLED_NODE so the packaged sidecar can load native Pi extensions",
  );
});

test("the sidecar bundle inlines every runtime dependency", async () => {
  // The sidecar runs as its own process out of `resources/agent-runtime/`.
  // Nothing resolves modules from there: there is no `node_modules` above it,
  // and `app.asar` is not on the ESM resolver's path for a separate process.
  // Marking a runtime dependency external therefore ships a bundle that dies
  // with `ERR_MODULE_NOT_FOUND` on the first import — the app then boots with
  // HOST_UNAVAILABLE, which reads as "the local service is unreachable" even
  // though host-core came up fine. A source checkout hides it, because
  // `release/win-unpacked/resources/agent-runtime/` can still walk up into the
  // repository's own `node_modules`; an installed copy cannot.
  //
  // `electron` is the one legitimate exception: this entry never imports it,
  // and it exists only as a build-time surface.
  const externals = bundleScriptSource.match(/external:\s*\[([^\]]*)\]/);
  assert.ok(externals, "bundle-sidecar.mjs must declare its externals");
  const listed = [...externals[1].matchAll(/"([^"]+)"/g)].map(([, spec]) => spec);
  assert.deepEqual(
    listed,
    ["electron"],
    "only `electron` may stay external; a runtime dependency left external cannot resolve from resources/agent-runtime",
  );
});
