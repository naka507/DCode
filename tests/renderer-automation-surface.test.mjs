import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * `window.__DCODE__` — the renderer automation surface contract.
 *
 * The surface is installed by the shell (`features/app/useAppShellRuntime.ts`)
 * and consumed by two callers that are not components:
 *
 *   1. the screenshot suite in `src/main/bootstrap/window.ts`, which drives the
 *      app through `executeJavaScript` to seed fixtures and switch surfaces;
 *   2. the e2e runners under `scripts/` (e.g. `e2e-three-column-layout.mjs`).
 *
 * Every call site uses optional chaining (`window.__DCODE__?.seedX?.()`),
 * so a surface that is missing a method does not throw — the fixture silently
 * no-ops and the screenshot is captured against an unseeded app. That failure
 * mode is invisible in a passing test run and invisible in review, which is why
 * it is pinned here: the surface must expose the capture rig's whole method set,
 * and there must be exactly one implementation of it.
 */

const root = fileURLToPath(new URL("../", import.meta.url));
const rendererRoot = join(root, "src", "renderer");
const captureSurface = join(rendererRoot, "capture", "renderer-api.ts");
const libSurface = join(rendererRoot, "lib", "renderer-api.ts");
const shellRuntime = join(
  rendererRoot,
  "features",
  "app",
  "useAppShellRuntime.ts",
);

/**
 * Every rig method the main process or an e2e runner calls through the surface.
 * Kept as an explicit list rather than derived from the rig: a method silently
 * dropped from the rig *and* the surface would otherwise still agree.
 */
const REQUIRED_RIG_METHODS = [
  "openWorkPanelArtifact",
  "collapseWorkPanel",
  "openWorkPanel",
  "openNewWorkPanelTab",
  "setWorkPanelWidth",
  "seedTranscript",
  "seedReviewChanges",
  "seedRunRows",
  "seedDelegationRows",
  "seedPlugins",
  "seedExtensions",
  "seedPluginThemes",
  "seedNotifications",
  "seedSidebarStatuses",
  "ensureVisualFixtures",
];

/** The navigation/toast shims that are always present, rig or not. */
const REQUIRED_SHIMS = [
  "setPage",
  "refreshProviders",
  "selectSession",
  "setSettingsTab",
  "setThemeAttr",
  "clearProject",
  "showToast",
];

function read(path) {
  assert.ok(existsSync(path), `expected ${path} to exist`);
  return readFileSync(path, "utf8");
}

test("the capture surface lives with the rig it loads", () => {
  assert.ok(
    existsSync(captureSurface),
    "src/renderer/capture/renderer-api.ts is missing; the automation surface " +
      "belongs beside capture-rig.ts, which it import()s on first fixture call",
  );
  assert.ok(
    existsSync(join(rendererRoot, "capture", "capture-rig.ts")),
    "src/renderer/capture/capture-rig.ts is missing",
  );
});

test("the surface declares every rig method the callers drive", () => {
  const source = read(captureSurface);
  const declared = new Set(
    [...source.matchAll(/^\s+"([A-Za-z]\w+)",$/gm)].map((m) => m[1]),
  );
  const missing = REQUIRED_RIG_METHODS.filter((name) => !declared.has(name));
  assert.deepEqual(
    missing,
    [],
    `the automation surface no longer wires these rig methods, so the ` +
      `screenshot fixtures that call them would silently no-op: ${missing.join(", ")}`,
  );
  for (const name of REQUIRED_SHIMS) {
    assert.match(
      source,
      new RegExp(`\\b${name}:`),
      `the surface is missing the always-installed shim \`${name}\``,
    );
  }
});

test("the rig is loaded lazily, behind __PI_CAPTURE__", () => {
  const source = read(captureSurface);
  // A static import would put the fixture code in every production bundle.
  assert.ok(
    /import\(\s*["']\.\/capture-rig["']\s*\)/.test(source),
    "capture-rig must be loaded with a dynamic import() so production bundles " +
      "never evaluate the fixtures",
  );
  assert.ok(
    source.includes("__PI_CAPTURE__"),
    "the fixture stubs must gate on window.__PI_CAPTURE__",
  );
});

test("there is exactly one implementation of the surface", () => {
  const shell = read(shellRuntime);
  const installed = shell.match(
    /import\s*\{\s*installRendererApi\s*\}\s*from\s*"([^"]+)"/,
  );
  assert.ok(installed, "the shell no longer imports installRendererApi");

  const specifier = installed[1];
  assert.equal(
    specifier,
    "../../capture/renderer-api",
    `the shell must install the surface from capture/renderer-api.ts (found ` +
      `"${specifier}"). A second implementation under lib/ drifts: it omitted ` +
      "the rig's seed* methods and made every screenshot fixture a silent no-op.",
  );

  // There is no second spelling: the surface lives only under `capture/`. A
  // re-export left behind here is dead code that invites the next author to
  // edit the wrong file.
  assert.ok(
    !existsSync(libSurface),
    "src/renderer/lib/renderer-api.ts is back; the surface has exactly one " +
      "home (capture/renderer-api.ts) and a second path is how the two drifted",
  );
});

test("every method the main process drives exists on the surface", () => {
  // Read the call sites rather than trusting the list above: this catches a new
  // fixture added to the screenshot suite without a matching surface method.
  const main = readFileSync(join(root, "src", "main", "bootstrap", "window.ts"), "utf8");
  const called = new Set(
    [...main.matchAll(/__DCODE__\?\.([A-Za-z]\w*)/g)].map((m) => m[1]),
  );
  assert.ok(called.size > 0, "expected the screenshot suite to drive the surface");

  const source = read(captureSurface);
  const declared = new Set([
    ...[...source.matchAll(/^\s+"([A-Za-z]\w+)",$/gm)].map((m) => m[1]),
    ...[...source.matchAll(/^\s{4}([A-Za-z]\w*):/gm)].map((m) => m[1]),
  ]);
  const missing = [...called].filter((name) => !declared.has(name)).sort();
  assert.deepEqual(
    missing,
    [],
    `src/main/bootstrap/window.ts drives these surface methods that do not ` +
      `exist, so those fixtures no-op silently: ${missing.join(", ")}`,
  );
});
