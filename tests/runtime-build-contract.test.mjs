import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const desktopPackageUrl = new URL("../package.json", import.meta.url);

// This repo keeps the workspace packages under `src/`, so there is no
// pnpm dependency graph left to rebuild. The artifact that *can* go stale is the
// agent-runtime sidecar bundle: `src/main/agent-sidecar.ts` spawns it from
// `resources/agent-runtime/sidecar.js` in a packaged app, and electron-builder
// copies whatever `resources/runtime` holds at packaging time. Every
// entry point that bundles or packages must therefore rebuild it first, or a
// release ships the previous build's sidecar.
const sidecarBuild = "npm run build:sidecar";
const rendererBuild = "electron-vite build";

const readScripts = async () => {
  const pkg = JSON.parse(await readFile(desktopPackageUrl, "utf8"));
  return pkg.scripts ?? {};
};

test("the sidecar bundle is built by its own script before anything consumes it", async () => {
  const scripts = await readScripts();

  assert.match(
    scripts["build:sidecar"] ?? "",
    /node scripts\/bundle-sidecar\.mjs/,
    "build:sidecar must run the sidecar bundler",
  );
});

test("desktop dev rebuilds the sidecar before Electron starts", async () => {
  const scripts = await readScripts();
  const predev = scripts.predev ?? "";

  assert.ok(
    predev.includes(sidecarBuild),
    "predev must rebuild the sidecar bundle",
  );
});

test("packaging scripts rebuild the sidecar before bundling", async () => {
  const scripts = await readScripts();

  for (const name of ["pack", "dist", "dist:mac", "dist:win", "dist:linux"]) {
    const script = scripts[name] ?? "";

    assert.ok(
      script.includes(sidecarBuild),
      `${name} must rebuild the sidecar so packaging never consumes a stale runtime/`,
    );
    assert.ok(
      script.indexOf(sidecarBuild) < script.indexOf(rendererBuild),
      `${name} must rebuild the sidecar before ${rendererBuild}`,
    );
  }
});

test("the packaged sidecar ships as ESM beside a type-module manifest", async () => {
  const pkg = JSON.parse(await readFile(desktopPackageUrl, "utf8"));
  const entry = pkg.build.extraResources.find((resource) => resource.to === "agent-runtime");

  assert.deepEqual(
    entry,
    { from: "resources/runtime", to: "agent-runtime" },
    "extraResources must copy the whole runtime directory, manifest included",
  );
  assert.match(
    (await readScripts()).clean ?? "",
    /rmSync\('resources\/runtime'/,
    "clean must remove runtime so a stale sidecar cannot survive a clean checkout",
  );
});
