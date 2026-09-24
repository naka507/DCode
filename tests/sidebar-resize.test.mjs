import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

/**
 * The expanded sidebar's resize contract.
 *
 * Upstream read `components/Sidebar.tsx` plus `readAppSource()` (App.tsx and
 * every module under `features/app`). The Vue port splits the same surface
 * across `components/Sidebar.vue` (the handle and the gesture) and
 * `features/app/AppShell.vue` + `features/app/useAppShellRuntime.ts` (the
 * shell-owned width), so all three are read here.
 *
 * Every assertion below was retranslated from JSX to the Vue reality:
 *
 *  - `className={cx("sidebar-resize-handle no-drag"` -> the template's static
 *    `class="sidebar-resize-handle no-drag"`; a Vue SFC cannot call `cx()` for
 *    a constant class list.
 *  - `onPointerDown={startSidebarResize}` and the sibling `onX` props -> the
 *    `@pointerdown` / `@pointermove` / `@pointercancel` /
 *    `@lostpointercapture` / `@keydown` bindings, and `onDoubleClick` ->
 *    `@dblclick` (Vue's DOM-event spelling).
 *  - `onResizeCollapse` (a callback prop) -> the `resize-collapse` emit on
 *    `Sidebar.vue` plus its `handleSidebarResizeCollapse` handler in the
 *    runtime; the shell passes it as `@resize-collapse`.
 *  - `"--ds-sidebar-width": `${sidebarWidth}px`` -> the same style key with
 *    `sidebarWidth.value`, because the runtime's width is a `ref` and
 *    `AppShell.vue` reads it inside a `computed`.
 *  - `sidebarResetWidth(widthMax)` -> `sidebarResetWidth(props.widthMax)`:
 *    props are read through `props` in `<script setup>`.
 */

const sidebarSource = await readFile(
  new URL("../src/renderer/components/Sidebar.vue", import.meta.url),
  "utf8",
);
const appShellSource = await readFile(
  new URL("../src/renderer/features/app/AppShell.vue", import.meta.url),
  "utf8",
);
const runtimeSource = await readFile(
  new URL("../src/renderer/features/app/useAppShellRuntime.ts", import.meta.url),
  "utf8",
);
const appSource = `${appShellSource}\n${runtimeSource}`;
const globalStyles = await loadStyles();

test("the sidebar exposes an accessible pointer and keyboard resize handle", () => {
  assert.match(sidebarSource, /class="sidebar-resize-handle no-drag"/);
  assert.match(sidebarSource, /role="separator"/);
  assert.match(sidebarSource, /aria-orientation="vertical"/);
  assert.match(sidebarSource, /@pointerdown="startSidebarResize"/);
  assert.match(sidebarSource, /@pointermove="moveSidebarResize"/);
  assert.match(sidebarSource, /@pointercancel="cancelSidebarResize"/);
  assert.match(sidebarSource, /@lostpointercapture="cancelSidebarResize"/);
  assert.match(sidebarSource, /requestAnimationFrame\(\(\) =>/);
  assert.match(sidebarSource, /event\.key === "ArrowRight"/);
  assert.match(sidebarSource, /event\.key === "Home"/);
  assert.match(sidebarSource, /finishSidebarResize\(true\)/);
  assert.match(sidebarSource, /finishSidebarResize\(true, true\)/);
  assert.match(sidebarSource, /resize-collapse/);
  assert.match(sidebarSource, /sidebarPointerResize\(/);
  assert.match(sidebarSource, /@dblclick="resetSidebarWidth"/);
  assert.match(sidebarSource, /sidebarResetWidth\(props\.widthMax\)/);
});

test("sidebar width is shell-owned and the resize affordance is edge-anchored", () => {
  assert.match(appSource, /loadSidebarWidth\(\)/);
  assert.match(appSource, /saveSidebarWidth\(nextWidth\)/);
  assert.match(appSource, /handleSidebarResizeCollapse/);
  assert.match(appSource, /sidebarPreferredWidthRef/);
  assert.match(
    appSource,
    /"--ds-sidebar-width":\s*`\$\{sidebarWidth\.value\}px`/,
  );
  assert.match(globalStyles, /\.sidebar\s*\{[\s\S]*?position:\s*relative/);
  assert.match(
    globalStyles,
    /\.sidebar-resize-handle\s*\{[\s\S]*?right:\s*0;[\s\S]*?cursor:\s*col-resize/,
  );
  assert.match(globalStyles, /\.sidebar-resize-handle\s*\{[\s\S]*?touch-action:\s*none/);
  const handleBlock = globalStyles.match(/\.sidebar-resize-handle\s*\{[^}]+\}/)?.[0] ?? "";
  assert.match(handleBlock, /cursor:\s*col-resize/);
  assert.doesNotMatch(handleBlock, /display:\s*none/);
});

test("sidebar hover does not paint a full-height resize rail", () => {
  const marker = globalStyles.match(
    /\.sidebar-resize-handle::after\s*\{[^}]+\}/s,
  )?.[0] ?? "";

  assert.match(marker, /top:\s*50%/);
  assert.match(marker, /height:\s*32px/);
  assert.match(marker, /border-radius:\s*var\(--radius-full\)/);
  assert.match(globalStyles, /\.sidebar-resize-handle:hover::after,/);
  assert.doesNotMatch(globalStyles, /\.sidebar:hover\s+\.sidebar-resize-handle::after/);
  assert.match(
    globalStyles,
    /\.sidebar-resize-handle:focus-visible\s*\{[^}]*outline:\s*none/s,
  );
});

test("the chat reserves one row for shrinking composer controls", () => {
  assert.match(
    globalStyles,
    /\.main-pane\s*\{[\s\S]*?min-width:\s*var\(--ds-main-pane-min-width, 450px\);/,
  );
  assert.match(
    globalStyles,
    /\.composer-toolbar\s*\{[\s\S]*?flex-wrap:\s*nowrap;/,
  );
  assert.match(
    globalStyles,
    /\.composer-left,\s*\.composer-right\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?flex:\s*0 1 auto;/,
  );
  assert.doesNotMatch(
    globalStyles,
    /\.composer-left,\s*\.composer-right\s*\{[^}]*flex:\s*0 0 auto;/,
  );
  assert.match(
    globalStyles,
    /\.mode-chip\s*\{[\s\S]*?white-space:\s*nowrap;/,
  );
  assert.match(
    globalStyles,
    /\.mode-chip > span\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/,
  );
});
