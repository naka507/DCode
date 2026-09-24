import {
  readStoreModuleSync,
  readStoreSourceSync,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";
/**
 * The work panel's own resize-separator contract.
 *
 * The Vue component is `src/renderer/components/workpanel/WorkPanel.vue`, read
 * here. This file carries only the `work-panel.test.mjs` assertions that are
 * about the separator: the rest covers surfaces dcode handles in its own
 * suites (`work-panel-window.test.mjs` for the native reservation,
 * `work-panel-resize.test.mjs` for the width math,
 * `work-panel-presentation.test.mjs` for the presentation handshake).
 *
 * Retranslated, not transliterated:
 *
 *  - `aria-valuemin={Math.min(panelMinimum, layout.maxPanelWidth)}` and its
 *    `max`/`now` siblings became the `resizeMin` / `resizeMax` / `resizeNow`
 *    computeds, so the assertion reads the computed bodies and the template
 *    binding separately.
 *  - `onPointerDown={onPanelResizeStart}` -> `@pointerdown="onPanelResizeStart"`,
 *    and `onDoubleClick={onPanelResizeReset}` -> `@dblclick="onPanelResizeReset"`.
 *  - `if (drag) finishPanelResize(event.currentTarget, drag.pointerId, true)`
 *    gained `as HTMLDivElement`, because `event.currentTarget` is `EventTarget`
 *    in the DOM typings while a synthetic event already narrowed it.
 *  - `workPanelResetWidth(panelMinimum, layout.maxPanelWidth)` reads through
 *    `props`/`computed` refs in `<script setup>`, hence the `.value` suffixes.
 *  - `tabIndex={0}` -> `:tabindex="0"` (Vue's lowercase attribute spelling).
 *
 * No counterpart: `panelSource` also asserts `data-work-panel-resizing` (dcode
 * sets the attribute from the same `watch(isResizing)`), which is kept below,
 * and the global stylesheet assertions, which map onto
 * `src/renderer/styles/work-panel.css`.
 *
 * Extended by `58b301a1` ("open the Review panel only on explicit user
 * action"), which replaced the `workspace artifacts attach review to their
 * originating session` case with `tool results never open the Review tab on
 * their own`, reading the composed store source. The Vue tree reads the same
 * concatenated store source through `readStoreSourceSync`, and the companion
 * claim that the `+` launcher row is what still opens Review
 * (`bundled-plugins.test.mjs`, same commit) is asserted against
 * `WorkPanel.vue` here instead of a separate bundled-plugins file.
 */

const panelSource = await readFile(
  new URL("../src/renderer/components/workpanel/WorkPanel.vue", import.meta.url),
  "utf8",
);
const storeSource = readStoreSourceSync();
const eventsSource = readStoreModuleSync("slices/events-slice.ts");
const globalStyles = await loadStyles();

test("work panel separator exposes internal panel width resizing", () => {
  assert.match(panelSource, /role="separator"/);
  assert.match(panelSource, /:aria-label="t\('panel\.resize'\)"/);
  assert.match(
    panelSource,
    /const resizeMin = computed\(\(\) =>\s*Math\.min\(/,
  );
  assert.match(
    panelSource,
    /const resizeMax = computed\(\(\) =>\s*Math\.max\(/,
  );
  assert.match(
    panelSource,
    /Math\.round\(panelDragWidth\.value \?\? renderPanelWidth\.value\)/,
  );
  assert.match(panelSource, /:aria-valuemin="resizeMin"/);
  assert.match(panelSource, /:aria-valuemax="resizeMax"/);
  assert.match(panelSource, /:aria-valuenow="resizeNow"/);
  assert.match(panelSource, /:tabindex="0"/);
  assert.match(panelSource, /startClientX:\s*event\.clientX/);
  assert.match(panelSource, /startWidth/);
  assert.match(panelSource, /startWidth \+ drag\.startClientX - event\.clientX/);
  assert.match(panelSource, /@pointerdown="onPanelResizeStart"/);
  assert.match(panelSource, /requestAnimationFrame/);
  assert.match(panelSource, /event\.key === "ArrowLeft"/);
  assert.match(panelSource, /event\.key === "ArrowRight"/);
  assert.match(panelSource, /event\.key === "Escape" && drag/);
  assert.match(panelSource, /@pointerup="onPanelResizeCommit"/);
  assert.match(panelSource, /@pointercancel="onPanelResizeCancel"/);
  assert.match(panelSource, /@lostpointercapture="onPanelResizeCancel"/);
  assert.match(panelSource, /@keydown="onPanelResizeKeyDown"/);
  assert.match(panelSource, /@dblclick="onPanelResizeReset"/);
  assert.match(
    panelSource,
    /if \(drag\) finishPanelResize\(event\.currentTarget as HTMLDivElement, drag\.pointerId, true\)/,
  );
  assert.match(
    panelSource,
    /workPanelResetWidth\(panelMinimum\.value, layout\.value\.maxPanelWidth\)/,
  );
  assert.match(panelSource, /workPanelWidthBounds\(/);
  assert.match(panelSource, /data-work-panel-resizing/);
  assert.match(globalStyles, /\.work-panel-resize \{[^}]*width:\s*10px;/s);
  assert.match(globalStyles, /touch-action:\s*none/);
  assert.match(globalStyles, /\.work-panel-resize:focus-visible/);
  // Same short grip as the sidebar: 32px, centered, no full-height rail.
  const resizeMarker =
    globalStyles.match(/\.work-panel-resize::after\s*\{[^}]+\}/s)?.[0] ?? "";
  assert.match(resizeMarker, /top:\s*50%/);
  assert.match(resizeMarker, /height:\s*32px/);
  assert.match(resizeMarker, /border-radius:\s*var\(--radius-full\)/);
  assert.match(globalStyles, /\.work-panel-resize:hover::after,/);
  assert.match(
    globalStyles,
    /\.work-panel-resize:focus-visible::after,[\s\S]*?background:\s*var\(--ds-accent\)/,
  );
});

test("tool results never open the Review tab on their own", () => {
  // Review opens only from an explicit user action: the viewport toggle
  // reveals the retained context and the `+` launcher lists its row. A
  // successful Write/Edit may not record, activate, or reveal a tab for any
  // session, visible or background.
  assert.doesNotMatch(storeSource, /shouldOpenReviewArtifact/);
  assert.doesNotMatch(
    storeSource,
    /openWorkPanelTabForSession\([\s\S]{0,120}toolWorkPanelTab\("review"\)/,
  );
  assert.match(storeSource, /openWorkPanelTabForSession:/);
});

test("Review opens only from the New launcher row", () => {
  // The other half of the same contract: the removal must not remove the way
  // Review appears at all. The Vue panel keeps the same host-owned launcher row
  // (`panel.tabs.review` -> `review`), and the event slice may not reach for it.
  // event slice may not reach for it.
  assert.match(panelSource, /toolWorkPanelTab\("review"\)/);
  assert.doesNotMatch(eventsSource, /shouldOpenReviewArtifact|toolWorkPanelTab\("review"\)/);
});
