/**
 * Provider row reordering, end to end across the renderer and main halves.
 *
 * There is no other case list for this feature; what is guarded here is the
 * seam that a refactor can silently break, in the order the move travels:
 *
 *  - `shared/protocol.ts` declares the channel, and `IPC_WHITELIST` derives from
 *    it, so the preload bridge will let it through;
 *  - `renderer/lib/api.ts` names the same channel;
 *  - `main/ipc/provider-ipc.ts` forwards it to the host method the Rust side
 *    actually answers — `providers.reorder` — which is the one string that has
 *    to match across the language boundary;
 *  - `use-card-reorder.ts` owns the pointer drag and `useProviderReorder.ts` the
 *    optimistic write, both of which are Vue composables;
 *  - `ModelConfigPage.vue` binds them onto the row;
 *  - the row's class names and both locale catalogs carry the feature's copy.
 *
 * The pure move algebra (`reorderItem`, `visibleNeighborMove`, `dropPlacement`)
 * is already executed in `tests/model-reorder.test.mjs`, so it is not repeated.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IPC, IPC_WHITELIST } from "../src/shared/protocol.ts";
import { definedClasses, templateOf, usedClasses } from "./helpers/class-contract.mjs";
import { loadStylesSync } from "./helpers/styles.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const api = read("../src/renderer/lib/api.ts");
const providerIpc = read("../src/main/ipc/provider-ipc.ts");
const cardReorder = read("../src/renderer/hooks/use-card-reorder.ts");
const providerReorder = read("../src/renderer/components/settings/useProviderReorder.ts");
const page = read("../src/renderer/components/settings/ModelConfigPage.vue");
const en = read("../src/i18n/locales/en/index.ts");
const zh = read("../src/i18n/locales/zh-CN/index.ts");

test("the reorder channel is declared and therefore whitelisted for the preload bridge", () => {
  assert.equal(IPC.invoke.providersReorder, "dcode/providers/reorder");
  // The bridge refuses any channel outside this set, so declaring is enabling.
  assert.equal(IPC_WHITELIST.has(IPC.invoke.providersReorder), true);
  assert.match(api, /reorderProviders: \(input: ProviderReorderInput\) =>/);
  assert.match(api, /invoke<\{ ok: boolean \}>\(IPC\.invoke\.providersReorder, input\)/);
});

test("main forwards the channel to the host method the Rust side answers", () => {
  assert.match(
    providerIpc,
    /handle\(IPC\.invoke\.providersReorder, async \(input: ProviderReorderInput\) => \{/,
  );
  // This literal is the cross-language contract: `crates/host-core/src/rpc`
  // matches on exactly this name.
  assert.match(providerIpc, /host\.call\("providers\.reorder", input\)/);
  assert.match(providerIpc, /type ProviderReorderInput,/);
});

test("the card drag arms on movement, reads layout once, and releases every listener", () => {
  // A press that never travels 6px is a click, not a drag.
  assert.match(cardReorder, /Math\.hypot\(lastX - startX, lastY - startY\) < 6/);
  assert.match(cardReorder, /Read layout once, before any transform or scroll write\./);
  // A release can land before the scheduled frame, so the move is consumed first.
  assert.match(cardReorder, /update\(\);\s*\n\s*const destination = current\.rows\[current\.index\]/);
  for (const event of [
    "pointermove",
    "pointerup",
    "pointercancel",
    "keydown",
    "blur",
    "resize",
    "scroll",
  ]) {
    assert.match(cardReorder, new RegExp(`removeEventListener\\("${event}"`), event);
  }
  assert.match(cardReorder, /cancelAnimationFrame\(frame\)/);
  assert.match(cardReorder, /onScopeDispose\(\(\) => \{/);
  // Escape abandons a drag without committing it.
  assert.match(cardReorder, /next\.key === "Escape"/);
  // A press inside a control must not start a drag.
  assert.match(
    cardReorder,
    /closest\("button, input, select, textarea, a, \[contenteditable=true\]"\)/,
  );
  // Arrow keys reuse the shared visible-neighbour algebra.
  assert.match(cardReorder, /visibleNeighborMove\(/);
});

test("the released move previews immediately and rolls back through a refresh on failure", () => {
  assert.match(providerReorder, /reorderItem\(current, id, targetId, placement\)/);
  assert.match(providerReorder, /saving\.value = true;\s*\n\s*draft\.value = next;/);
  assert.match(providerReorder, /await api\.reorderProviders\(\{ id, targetId, placement \}\)/);
  assert.match(providerReorder, /await store\.appState\?\.refreshProviders\(\)/);
  assert.match(providerReorder, /t\("settings\.providerOrderFailed"/);
  assert.match(providerReorder, /variant: "error"/);
  // The optimistic draft is dropped once the write settles, accepted or not.
  assert.match(providerReorder, /saving\.value = false;\s*\n\s*draft\.value = null;/);
  // A second move cannot start while one is in flight.
  assert.match(providerReorder, /if \(pending \|\| toValue\(busy\)\) return;/);
  // The list handed to the drag hook is the preview, falling back to the store.
  assert.match(providerReorder, /draft\.value \?\? toValue\(providers\)/);
});

test("the provider list row carries the drag bindings and the drag styling", () => {
  const template = templateOf(page);
  assert.match(template, /:aria-busy="reorderSaving"/);
  assert.match(template, /v-for="provider in reorderProviders"/);
  assert.match(template, /:ref="reorderRowRef\(provider\.id\)"/);
  assert.match(template, /'is-dragging': reorderDraggingId === provider\.id/);
  assert.match(template, /:aria-label="t\('settings\.reorderProvider', \{ name: provider\.name \}\)"/);
  assert.match(template, /:tabindex="reorderDisabled \? -1 : 0"/);
  assert.match(template, /:aria-disabled="reorderDisabled"/);
  assert.match(template, /@keydown="onRowKeydown\(provider\.id, \$event\)"/);
  assert.match(template, /@dragstart="onRowDragStart\(\$event\)"/);
  assert.match(template, /@click\.capture="onRowClickCapture\(\$event\)"/);
  assert.match(template, /@pointerdown="onRowPointerDown\(provider\.id, \$event\)"/);
  // Any row-level operation in flight blocks a move.
  assert.match(
    page,
    /busyId\.value !== null \|\| testingId\.value !== null \|\| setupFor\.value !== null/,
  );

  const styles = loadStylesSync();
  assert.match(styles, /\.model-provider-row\s*\{[^}]*cursor: grab;/);
  assert.match(styles, /\.model-provider-row\.is-dragging\s*\{/);
  assert.match(styles, /\.model-provider-list\[aria-busy="true"\] \.model-provider-row/);
  assert.match(styles, /\.model-provider-row:focus-visible/);
  // The rendered class vocabulary is `vue-class-contract.test.mjs`'s job: it
  // walks every .vue file with the shared allowlist, so it is not re-checked.
});

test("both shipped locales name the row action and the failure", () => {
  for (const source of [en, zh]) {
    assert.match(source, /^    reorderProvider: "/m);
    assert.match(source, /^    providerOrderFailed: "/m);
  }
  assert.match(en, /reorderProvider: "Reorder \{\{name\}\}\./);
  assert.match(en, /providerOrderFailed: "Could not save provider order: \{\{error\}\}"/);
  assert.match(zh, /reorderProvider: "调整 \{\{name\}\} 的顺序。/);
  assert.match(zh, /providerOrderFailed: "无法保存供应商顺序：\{\{error\}\}"/);
});
