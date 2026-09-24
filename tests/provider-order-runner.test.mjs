/**
 * `scripts/e2e-provider-order.mjs` — the provider drag/drop runner: the
 * settings page's row drag, the keyboard move, the cancelled drag, the failed
 * save, the late catalog reply, the composer model menu, and the card-reorder
 * work budget, all against a real Rust host through the production IPC surface.
 *
 * A runner is the one artifact in this repository that no other gate can check.
 * `npm test` never executes it (it starts Electron), `vue-tsc` does not read it,
 * and the class contract only reads `.vue` templates. So a runner that queries a
 * selector the renderer stopped rendering, or that drives the wrong DOM event,
 * fails only when someone runs it against a real app — which per `AGENTS.md`
 * § 12 happens only on explicit request.
 *
 * This file closes that gap for the parts that can be checked statically. It is
 * deliberately biased towards the two contracts a copy-and-port can silently
 * break and nothing else in the tree can see:
 *
 *  1. **The DOM contract.** The fixture reaches for `.model-provider-row`,
 *     `.model-provider-row-name`, `.model-provider-row-actions button`,
 *     `.model-provider-thinking-chip`, `.composer-menu-entry` and
 *     `.composer-model-group`. Those class names live in `.vue` files and CSS,
 *     so the assertions below read the real components and fail if a rename
 *     happens without the fixture.
 *  2. **The event contract.** `use-card-reorder` listens for `pointermove`,
 *     `pointerup`, `pointercancel` and `keydown` on `window` (capture), and arms
 *     only after 6px of travel. The fixture dispatches exactly those, on exactly
 *     those targets; the assertions pin both sides.
 *
 * Everything else — that the drag actually reorders, that a cancelled drag does
 * not, that a failed write toasts and rolls back — is only provable by running
 * the runner, so it is not asserted here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const runnerPath = join(root, "scripts", "e2e-provider-order.mjs");
const fixturePath = join(root, "scripts", "e2e", "provider-order.ts");
const performancePath = join(
  root,
  "scripts",
  "e2e",
  "card-reorder-performance.ts",
);
const hostDriverPath = join(root, "scripts", "e2e", "host.mjs");
const pagePath = join(
  root,
  "src",
  "renderer",
  "components",
  "settings",
  "ModelConfigPage.vue",
);
const pickerPath = join(
  root,
  "src",
  "renderer",
  "features",
  "chat",
  "composer",
  "ComposerModelPicker.vue",
);
const reorderHookPath = join(
  root,
  "src",
  "renderer",
  "hooks",
  "use-card-reorder.ts",
);
const providerReorderPath = join(
  root,
  "src",
  "renderer",
  "components",
  "settings",
  "useProviderReorder.ts",
);
const apiPath = join(root, "src", "renderer", "lib", "api.ts");
const packagePath = join(root, "package.json");
const readmePath = join(root, "scripts", "README.md");

const runner = readFileSync(runnerPath, "utf8");
const fixture = readFileSync(fixturePath, "utf8");
const performance = readFileSync(performancePath, "utf8");
const hostDriver = readFileSync(hostDriverPath, "utf8");
const page = readFileSync(pagePath, "utf8");
const picker = readFileSync(pickerPath, "utf8");
const reorderHook = readFileSync(reorderHookPath, "utf8");
const providerReorder = readFileSync(providerReorderPath, "utf8");
const api = readFileSync(apiPath, "utf8");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const readme = readFileSync(readmePath, "utf8");

test("the runner is registered as an npm alias and documented", () => {
  assert.equal(
    packageJson.scripts["test:e2e:provider-order"],
    "node scripts/e2e-provider-order.mjs",
  );
  assert.match(
    readme,
    /^\| `e2e-provider-order\.mjs` \| `npm run test:e2e:provider-order` \|/m,
  );
});

test("the runner builds the Vue fixture with vite, not esbuild", () => {
  // `esbuild` cannot compile an SFC, so the renderer half has to go through
  // vite + the Vue plugin; the main-process half is plain TypeScript and stays
  // on esbuild, as the runner requires.
  assert.match(runner, /require\.resolve\("vite"\)/);
  assert.match(runner, /require\.resolve\("@vitejs\/plugin-vue"\)/);
  assert.match(runner, /plugins: \[vue\(\)\]/);
  assert.match(runner, /entry: join\(root, "scripts\/e2e\/provider-order\.ts"\)/);
  assert.match(runner, /formats: \["iife"\]/);
  assert.match(runner, /entryPoints: \[join\(root, "src\/main\/ipc\/provider-ipc\.ts"\)\]/);
  // One Vue instance for the fixture and the components it renders.
  assert.match(runner, /vue: join\(root, "node_modules\/vue"\)/);
});

test("the runner links the built stylesheet the rows are measured under", () => {
  // The fold's provider rows are tiles only under the real cascade, and the
  // scroller only scrolls with it, so the built CSS has to be present.
  assert.match(runner, /out\/renderer\/index\.html/);
  assert.match(runner, /matchAll\(\/<link\[\^>\]\+href="\\\.\\\/\(\[\^"\]\+\\\.css\)"\/g\)/);
  assert.match(runner, /no built stylesheet found/);
  assert.match(runner, /<link rel="stylesheet" href="\$\{styleSheets\[0\]/);
});

test("the runner resolves the host binary through the shared driver", () => {
  assert.match(runner, /import \{ resolveHostBinary \} from "\.\/e2e\/host\.mjs"/);
  assert.match(runner, /const binary = resolveHostBinary\(\)/);
  // The sibling-checkout entries the shared driver adds, without which every
  // runner needs a hand-set DCODE_HOST_BIN.
  assert.match(hostDriver, /join\(root, "\.\.", "dcore"\), join\(root, "\.\.", "\.\.", "dcore"\)/);
  assert.match(hostDriver, /for \(const profile of \["debug", "release"\]\)/);
});

test("the runner drives the real IPC, preload and host", () => {
  assert.match(runner, /registerProviderIpc\(\{/);
  assert.match(runner, /out\/preload\/index\.cjs/);
  assert.match(runner, /new Host\(\$\{JSON\.stringify\(binary\)\}/);
  // Every provider row is created through the host, and the invalid placements
  // are rejected by the host rather than by the fixture.
  assert.match(runner, /host\.call\("providers\.create"/);
  assert.match(runner, /host\.call\("settings\.set"/);
  assert.match(runner, /host\.call\("providers\.reorder", input\)/);
  assert.match(runner, /code !== "INVALID_PARAMS"/);
  // The order has to survive both a host restart and a page reload.
  assert.match(runner, /await host\.restart\(\)/);
  assert.match(runner, /providerOrderProbe\(true\)/);
  assert.match(runner, /PROVIDER_ORDER_PROBE /);
  assert.equal(runner.match(/PROVIDER_ORDER_PROBE /g).length, 4);
});

test("the fixture is the probe with the Vue bridges, and nothing else", () => {
  // The two entry points the runner calls.
  assert.match(fixture, /globalThis\.providerOrderProbe = async \(restart = false\)/);
  assert.match(fixture, /globalThis\.cardReorderPerformance = cardReorderPerformance/);
  // The Vue bridges, each one named in the fixture's own header.
  assert.match(fixture, /app\.config\.errorHandler = \(error\) => \{/);
  assert.match(fixture, /currentAppState\(\)/);
  assert.match(fixture, /patchAppState\(previous\)/);
  assert.match(fixture, /i18n\.global\.locale\.value = "zh-CN"/);
  // The store has to be built after Pinia is installed, as in `main.ts`.
  assert.match(fixture, /app\.use\(rendererPinia\);\s*\n\s*app\.use\(i18n\);\s*\n\s*initializeAppStore\(\)/);
  // The monkey-patched API surface, which the store reads through.
  assert.match(api, /reorderProviders: \(input: ProviderReorderInput\) =>/);
  assert.match(api, /listProviders: \(\) =>/);
  // The three interactions plus the two API stubs are all present.
  for (const literal of [
    "the whole card must follow the pointer",
    "surrounding cards must make room before dropping",
    "drag preview must not persist before release",
    "small click movement must not start dragging",
    "action buttons must not start card dragging",
    "cancelled drag changed order or left an indicator",
    "sorting changed a provider configuration",
    "sorting changed the default provider",
    "late catalog response reverted a saved order",
    "failed save must show an error",
    "overlapping moves must be blocked until saving finishes",
    "Escape must restore the accepted layout",
    "cancelling must stop automatic scrolling",
    "card reorder instruction must follow the interface language",
    "composer model menu did not follow provider order",
    "legacy providers should retain creation order",
    "cards should not display a separate drag handle",
    "saved provider order did not survive host and renderer restart",
    "configured provider rows missing",
    "render failed",
    "render errors",
  ]) {
    assert.ok(
      fixture.includes(literal),
      `the fixture no longer asserts "${literal}"`,
    );
  }
});

test("the fixture's selectors still exist in the renderer", () => {
  // Every selector the fixture queries, and the component that renders it.
  const selectors = [
    [".model-provider-row", page],
    [".model-provider-row-name", page],
    [".model-provider-row-actions", page],
    ["is-dragging", page],
    [".composer-model-thinking-chip", picker],
    [".composer-menu-entry", picker],
    [".composer-model-group", picker],
  ];
  for (const [selector, source] of selectors) {
    const name = selector.replace(/^\./, "");
    assert.ok(
      source.includes(name),
      `${name} is queried by the fixture but no longer rendered`,
    );
  }
  // `.model-provider-reorder` is asserted *absent*; it must stay absent. The
  // fixture's assertion only means something while no component renders it.
  assert.ok(
    !page.includes("model-provider-reorder"),
    "`.model-provider-reorder` came back, so the fixture's absence assertion is wrong",
  );
});

test("the fixture dispatches the events the drag hook actually listens for", () => {
  // `pointerdown` is bound on the row (the hook's `onRowPointerDown`); the other
  // four are window listeners the hook installs when a drag starts. The fixture
  // has to dispatch each on the matching target or the drag never starts.
  for (const event of ["pointermove", "pointerup", "pointercancel", "keydown"]) {
    assert.match(
      reorderHook,
      new RegExp(`window\\.addEventListener\\("${event}"`),
      `use-card-reorder no longer listens for ${event}`,
    );
  }
  for (const event of ["pointerdown", "pointermove"]) {
    assert.ok(
      fixture.includes(`new PointerEvent("${event}"`),
      `the fixture no longer dispatches ${event}`,
    );
  }
  // The release is one dispatch that chooses its own event name, so both
  // spellings live in a single ternary.
  assert.match(
    fixture,
    /new PointerEvent\(drop \? "pointerup" : "pointercancel"/,
    "the fixture no longer dispatches the drop and the cancel",
  );
  assert.ok(
    fixture.includes(`new KeyboardEvent("keydown"`),
    "the fixture no longer dispatches keydown",
  );
  // A row-targeted `pointermove` would never reach the hook, so the fixture must
  // dispatch the move and the release on `window`. The cancel rides the same
  // release dispatch (`drop ? "pointerup" : "pointercancel"`), so it is asserted
  // as part of that ternary rather than as a bare literal.
  for (const event of ["pointermove", "pointerup"]) {
    assert.match(
      fixture,
      new RegExp(`window\\.dispatchEvent\\(\\s*\\n\\s*new PointerEvent\\("${event}"`),
      `the fixture must dispatch ${event} on window`,
    );
  }
  assert.match(
    fixture,
    /window\.dispatchEvent\(\s*\n\s*new PointerEvent\(drop \? "pointerup" : "pointercancel"/,
    "the fixture must dispatch the drop and the cancel on window",
  );
  assert.match(
    fixture,
    /row\("C"\)\.dispatchEvent\(\s*\n\s*new PointerEvent\("pointerdown"/,
  );
  // A press that travels less than 6px is a click, so the fixture's "must not
  // start dragging" case depends on this threshold staying above 2px.
  const travel = reorderHook.match(
    /Math\.hypot\(lastX - startX, lastY - startY\) < (\d+)/,
  );
  assert.ok(travel, "use-card-reorder no longer has the arming threshold");
  assert.ok(
    Number(travel[1]) > 2,
    `the arming threshold dropped to ${travel[1]}px, which the fixture's 2px nudge would cross`,
  );
  // Escape is how the fixture cancels a drag mid-scroll.
  assert.match(reorderHook, /next\.key === "Escape"/);
});

test("the optimistic write the fixture observes is the one it stubs", () => {
  // The fixture replaces `api.reorderProviders`; the composable is what calls it.
  assert.match(providerReorder, /await api\.reorderProviders\(\{ id, targetId, placement \}\)/);
  // And a rejected write restores the accepted list through a refresh, which is
  // what makes the fixture's "late catalog response" case meaningful.
  assert.match(providerReorder, /await store\.appState\?\.refreshProviders\(\)/);
  assert.match(providerReorder, /if \(pending \|\| toValue\(busy\)\) return;/);
});

test("the card-reorder performance probe keeps its work budget", () => {
  // The controlled clock: rAF and geometry reads are counted, not timed.
  assert.match(performance, /window\.requestAnimationFrame = \(callback\) => \{/);
  assert.match(performance, /Element\.prototype\.getBoundingClientRect = function/);
  assert.match(performance, /for \(let index = 0; index < 200; index \+= 1\)/);
  assert.match(performance, /for \(let index = 0; index < 120; index \+= 1\) tick\(\)/);
  // The four bounds, each with its own message.
  assert.match(performance, /result\.burstRenders > 1/);
  assert.match(performance, /result\.idleRenders !== 0/);
  assert.match(performance, /result\.pendingIdleFrames !== 0/);
  assert.match(performance, /result\.geometryReadsAfterStart !== 0/);
  assert.match(performance, /drag preview exceeded its work budget/);
  assert.match(performance, /cancelled drag retained animation callbacks/);
  assert.match(performance, /release before paint lost the final destination or retained a callback/);
  assert.match(performance, /release left transient transforms behind/);
  assert.match(performance, /drag transforms extended automatic scrolling beyond the original content/);
  assert.match(performance, /unmount retained an animation callback/);
  // The move the release-before-paint case has to produce.
  assert.match(performance, /moves\[0\]\.target !== "4"/);
  assert.match(performance, /moves\[0\]\.placement !== "after"/);
  // The render counter the budget is expressed in.
  assert.match(performance, /renders \+= 1/);
  // The rows must live inside the element the probe measures and scrolls.
  assert.match(performance, /host\.append\(container\)/);
  assert.match(performance, /app\.mount\(container\)/);
});

test("both probes are reported separately so a failure names its own", () => {
  assert.match(runner, /throw new Error\("providerOrderProbe: " \+ String\(error\)\)/);
  assert.match(runner, /throw new Error\("cardReorderPerformance: " \+ String\(error\)\)/);
  // The combined result the runner prints carries every flag.
  assert.match(
    runner,
    /JSON\.stringify\(\{ \.\.\.interactions, restart: restart\.ok, performance \}\)/,
  );
});
