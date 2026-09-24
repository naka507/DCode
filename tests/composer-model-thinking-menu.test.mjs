import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";
import { readComposerSource } from "./helpers/source-contracts.mjs";

/**
 * Composer model × reasoning menu contract.
 *
 * Covers the composer model menu: the two files it spans
 * (`ComposerModelPicker.vue` for the markup, `hooks/useComposerModelMenu.ts`
 * for the controller) are read and joined, so every assertion still spans both
 * halves.
 *
 * Assertions pinned to Vue syntax, each noted at the site:
 *
 *  - `useState<ComposerMenuView>("root")` → `ref<ComposerMenuView>("root")`.
 *  - `className=` / `menuClassName=` / `tabIndex={-1}` → `class=` /
 *    `menu-class-name=` / `tabindex="-1"`.
 *  - `aria-expanded={open}` and friends → the `:attr="expr"` binding form.
 *  - `onClick={() => showView("thinking")}` → `@click="showView('thinking')"`,
 *    and the `{cond ? (<div className=…>)}` render guard → `v-if`.
 *  - `setView("root")` / `setQuery("")` → `view.value = "root"` /
 *    `query.value = ""` (a composable returns refs).
 *  - `thinkingQueueRef.current?.invalidate()` → `thinkingQueue.invalidate()`:
 *    the queue is created once during `setup`, so there is no lazily filled ref
 *    and no optional chain.
 *  - The `useEffect` body greps → the `watch([open, providers], …)` sources.
 *  - `loadProviderModels(candidate.id)` → `store.appState?.loadProviderModels(…)`.
 *  - `aria-label={group.providerDisplayName}` / `{group.providerDisplayName}` →
 *    `group.label`: the label is derived inside the `groups` computed.
 *  - The fixed-layer style greps: dcode's `.composer-model-thinking-menu`
 *    composes the shared `.composer-model-menu` rule (which is where
 *    `position: fixed` / `top: 0` live) and only overrides the width.
 *
 * Assertions with no Vue counterpart:
 *
 *  - `const thinkingMenuLevels = sessionThinkingMenuLevels(availableThinkingLevels)`:
 *    a plain value cannot be held here — `thinkingMenuLevels` is a
 *    `ComputedRef` the controller type, the `watch` sources and the template
 *    all read — so the same call sits inside the computed, over the same
 *    `availableThinkingLevels` local. The assertion pins that call and its
 *    argument name, not the statement shape.
 *  - `/className="composer-thinking"/` (the old collapsed chip) and the
 *    `icon-btn mode-chip thinking-chip` negative: retargeted at the Vue class
 *    strings; both remain negative.
 */

const [modelMenuSource, pickerSource] = await Promise.all([
  readFile(new URL("../src/renderer/features/chat/composer/hooks/useComposerModelMenu.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer/features/chat/composer/ComposerModelPicker.vue", import.meta.url), "utf8"),
]);
const composerSource = `${modelMenuSource}\n${pickerSource}`;
const stylesSource = await loadStyles();
test("Composer uses one model × reasoning popover with a root and in-place submenus", () => {
  assert.match(composerSource, /ref<ComposerMenuView>\("root"\)/);
  assert.match(composerSource, /showView\(['"]model['"]\)/);
  assert.match(composerSource, /showView\(['"]thinking['"]\)/);
  assert.match(
    composerSource,
    /menu-class-name="composer-model-menu composer-model-thinking-menu"/,
  );
  assert.match(composerSource, /role="menuitem"[\s\S]*?aria-haspopup="menu"/);
  assert.match(composerSource, /class="composer-menu-back"/);
  assert.match(composerSource, /IconChevronLeft/);
  assert.doesNotMatch(composerSource, /class="composer-thinking"/);
  assert.doesNotMatch(composerSource, /icon-btn mode-chip/);
});

/*
  The loop walks the whole composer source for every runtime thinking level,
  with `omit` appended, over `readComposerSource()`.
*/
const composerTreeSource = await readComposerSource();

test("composer exposes the runtime thinking level order and provider filtering", () => {
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max", "omit"]) {
    assert.match(composerTreeSource, new RegExp(`"${level}"`));
  }
  assert.match(composerTreeSource, /supportedThinkingLevels/);
  assert.match(composerTreeSource, /supportsReasoning/);
  assert.match(composerTreeSource, /thinkingLevelForProvider/);
  assert.match(composerTreeSource, /sessionThinkingMenuLevels/);
});

test("model and reasoning selection return to the root without closing", () => {
  assert.match(composerSource, /await store\.appState\?\.configureActiveSession\(\{[\s\S]*?thinkingLevel: nextThinkingLevel/);
  assert.match(composerSource, /query\.value = "";[\s\S]*?view\.value = "root"/);
  assert.match(composerSource, /const selectThinkingLevel = async/);
  assert.match(composerSource, /view\.value = "root";[\s\S]*?thinkingHighlight\.value = -1/);
  assert.match(
    composerSource,
    /const thinkingMenuLevels = computed<SessionThinkingLevel\[\]>\(\(\) => \{[\s\S]*?const availableThinkingLevels = providerThinkingLevels\(thinkingProvider\.value\);[\s\S]*?return sessionThinkingMenuLevels\(availableThinkingLevels\);/,
  );
});

test("the menu root carries the reasoning slider under the reasoning entry", () => {
  // The root view renders the slider directly beneath the Reasoning level
  // entry; the entry itself still opens the classic radio-list submenu.
  assert.match(
    composerSource,
    /@click="showView\('thinking'\)"[\s\S]*?class="composer-thinking-slider"/,
  );
  assert.match(
    composerSource,
    /v-if="thinkingMenuLevels\.length > 1" class="composer-thinking-slider"/,
  );
  assert.match(composerSource, /type="range"/);
  assert.match(composerSource, /class="composer-thinking-range"/);
  assert.match(composerSource, /:aria-label="t\('chat\.reasoningLevel'\)"/);
  assert.match(
    composerSource,
    /:aria-valuetext="thinkingMenuLevels\[thinkingSliderValue\] \?\? thinkingLevel"/,
  );
  assert.match(composerSource, /const commitThinkingLevel = /);
  assert.match(composerSource, /if \(!\(await commitThinkingLevel\(level\)\)\) return;/);
  assert.match(
    composerSource,
    /if \(level && level !== props\.thinkingLevel\) void commitThinkingLevel\(level\);/,
  );
  assert.match(
    composerSource,
    /if \(THINKING_SLIDER_KEYS\.has\(event\.key\)\) event\.stopPropagation\(\);/,
  );
  assert.match(composerSource, /composer-thinking-tick/);
  assert.match(composerSource, /createLatestCommitQueue/);
  assert.match(composerSource, /thinkingQueue\.invalidate\(\)/);
  assert.match(pickerSource, /tabindex="-1"/);
  assert.match(pickerSource, /class="composer-thinking-ticks" aria-hidden="true"/);
  assert.doesNotMatch(pickerSource, /composer-thinking-tick[\s\S]{0,200}role="menuitemradio"/);
  assert.match(stylesSource, /\.composer-thinking-range::-webkit-slider-runnable-track/);
  assert.match(stylesSource, /\.composer-thinking-range::-webkit-slider-thumb/);
  assert.match(stylesSource, /\.composer-thinking-range::-moz-range-thumb/);
  assert.match(stylesSource, /\.composer-thinking-tick\.active\s*\{/);
  assert.doesNotMatch(
    composerSource,
    /thinkingMode|showThinkingMode|ThinkingSelectionMode|thinkingCommitChainRef/,
  );
});

test("opening the combined menu preloads model metadata before its submenu", () => {
  assert.match(
    composerSource,
    /watch\(\[open, providers\], \(\) => \{\n    if \(!open\.value\) return;\n    for \(const candidate of providers\.value\)\s*\{/,
  );
  assert.match(composerSource, /void store\.appState\?\.loadProviderModels\(candidate\.id\);/);
  assert.match(composerSource, /\}\);\n\n  watch\(open, \(\) => \{/);
});

test("the combined chip and menu meet the compact accessible visual contract", () => {
  assert.match(composerSource, /aria-haspopup="menu"/);
  assert.match(composerSource, /:aria-expanded="open"/);
  assert.match(composerSource, /role="menuitemradio"/);
  assert.match(composerSource, /:aria-checked="model\.active"/);
  assert.match(composerSource, /:aria-checked="thinkingLevel === level"/);
  assert.match(composerSource, /event\.key === "ArrowLeft"/);
  assert.match(composerSource, /event\.key === "Escape"/);
  // The fixed layer is the shared menu rule; the thinking variant sets width.
  assert.match(stylesSource, /\.composer-model-menu\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(stylesSource, /\.composer-model-menu\s*\{[\s\S]*?top:\s*0;/);
  assert.match(
    stylesSource,
    /\.composer-model-thinking-menu\s*\{[\s\S]*?width:\s*min\(300px,\s*calc\(100vw - 24px\)\)/,
  );
  assert.match(
    composerSource,
    /class="composer-model-thinking-icon"[\s\S]*?<IconBot :size="14" \/>/,
  );
  assert.doesNotMatch(stylesSource, /\.composer-model-thinking-icon\.is-off/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)/);
});

test("model options are visually nested under their provider heading", () => {
  assert.match(composerSource, /composer-plus-item composer-model-option/);
  assert.match(
    stylesSource,
    /\.composer-model-group \.composer-model-option\s*\{[\s\S]*?padding-left:\s*22px/,
  );
});

test("model groups use the account-aware display name", () => {
  assert.match(composerSource, /composerProviderDisplayName\(candidate\)/);
  assert.match(composerSource, /composerProviderSearchText\(candidate\)/);
  assert.match(composerSource, /:aria-label="group\.label"/);
  assert.match(composerSource, /\{\{ group\.label \}\}/);
});

test("provider headings establish a stronger type level than model rows", () => {
  assert.match(
    stylesSource,
    /\.composer-model-group-label\s*\{[\s\S]*?font-size:\s*var\(--text-md\)/,
  );
  assert.match(
    stylesSource,
    /\.composer-model-group \.composer-model-option\s*\{[\s\S]*?font-size:\s*var\(--text-sm\)[\s\S]*?font-weight:\s*var\(--font-weight-normal\)/,
  );
  assert.match(
    stylesSource,
    /:lang\(zh-CN\) \.composer-model-group-label\s*\{[\s\S]*?text-transform:\s*none/,
  );
});
