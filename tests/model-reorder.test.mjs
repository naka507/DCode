import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  dropPlacement,
  reorderItem,
  sameDropTarget,
  visibleNeighborMove,
} from "../src/renderer/lib/list-reorder.ts";
import { loadStyles } from "./helpers/styles.mjs";

/**
 * Selected-model drag reordering.
 *
 * The placement and visible-neighbour algebra is executed here, beside a source
 * contract that the handle is the only drag source, so selecting an id still
 * copies it. That contract reads the component at its current path.
 *
 * Assertions pinned to Vue syntax, noted at the site:
 *  - `useModelReorder(visibleChosen, setModels, busy)` is the composable call;
 *    its result is bound as `reorder`, and `{...reorder.handleEvents(id)}` /
 *    `{...reorder.rowEvents(id)}` become named `@dragstart` / `@drop` bindings
 *    with the row id passed as the first argument.
 *  - `cx("provider-chosen-row", reorder.draggingId === binding.id && "is-dragging")`
 *    is the Vue object `:class` form.
 *  - `data-drop-placement={...}` is the `:data-drop-placement` binding.
 */

const ids = (models) => models.map((model) => model.id);
const models = [
  { id: "first", alias: "Fast", contextWindow: 128000, thinkingLevels: ["high"] },
  { id: "hidden", supportsImages: true },
  { id: "middle", maxTokens: 32000 },
  { id: "last", defaultThinkingLevel: "high", apiStyle: "responses" },
];

const [pickerSource, styles] = await Promise.all([
  readFile(
    new URL("../src/renderer/components/settings/ModelSelectionPanes.vue", import.meta.url),
    "utf8",
  ),
  loadStyles(),
]);

test("moves the first model to the end and the last to the beginning", () => {
  assert.deepEqual(ids(reorderItem(models, "first", "last", "after")), [
    "hidden", "middle", "last", "first",
  ]);
  assert.deepEqual(ids(reorderItem(models, "last", "first", "before")), [
    "last", "first", "hidden", "middle",
  ]);
});

test("inserts on either side of a target in both drag directions", () => {
  assert.deepEqual(ids(reorderItem(models, "first", "middle", "before")), [
    "hidden", "first", "middle", "last",
  ]);
  assert.deepEqual(ids(reorderItem(models, "last", "hidden", "after")), [
    "first", "hidden", "last", "middle",
  ]);
});

test("a filtered drag retains hidden models and every binding's overrides", () => {
  const next = reorderItem(models, "last", "first", "before");
  assert.deepEqual(ids(next), ["last", "first", "hidden", "middle"]);
  for (const binding of models) {
    assert.equal(next.find((model) => model.id === binding.id), binding);
  }
  assert.deepEqual(ids(models), ["first", "hidden", "middle", "last"]);
});

test("same-place drops and stale or missing targets leave the draft unchanged", () => {
  for (const [source, target, side] of [
    ["first", "first", "after"],
    ["first", "hidden", "before"],
    ["hidden", "first", "after"],
    ["removed", "first", "before"],
    ["first", "removed", "after"],
  ]) {
    assert.equal(reorderItem(models, source, target, side), models);
  }
  assert.deepEqual(reorderItem([], "first", "last", "after"), []);
});

test("drop placement splits a row at its vertical midpoint", () => {
  assert.equal(dropPlacement(10, 0, 40), "before");
  assert.equal(dropPlacement(20, 0, 40), "before");
  assert.equal(dropPlacement(21, 0, 40), "after");
});

test("arrow keys move past the neighboring visible row and no-op at the ends", () => {
  const visible = [{ id: "shown-a" }, { id: "shown-b" }, { id: "shown-c" }];
  assert.deepEqual(visibleNeighborMove(visible, "shown-a", "down"), {
    targetId: "shown-b",
    placement: "after",
  });
  assert.deepEqual(visibleNeighborMove(visible, "shown-c", "up"), {
    targetId: "shown-b",
    placement: "before",
  });
  assert.equal(visibleNeighborMove(visible, "shown-a", "up"), null);
  assert.equal(visibleNeighborMove(visible, "shown-c", "down"), null);
  assert.equal(visibleNeighborMove(visible, "missing", "down"), null);
});

test("a filtered drag before the first visible row keeps hidden bindings in place", () => {
  const all = [
    { id: "shown-a" },
    { id: "hidden-a" },
    { id: "shown-b" },
    { id: "hidden-b" },
    { id: "shown-c" },
  ];
  const visible = all.filter((model) => model.id.startsWith("shown-"));
  const move = visibleNeighborMove(visible, "shown-c", "up");
  assert.deepEqual(move, { targetId: "shown-b", placement: "before" });
  assert.deepEqual(
    ids(reorderItem(all, "shown-c", "shown-a", "before")),
    ["shown-c", "shown-a", "hidden-a", "shown-b", "hidden-b"],
  );
  assert.deepEqual(
    ids(reorderItem(all, "shown-a", move.targetId, move.placement)),
    ["hidden-a", "shown-a", "shown-b", "hidden-b", "shown-c"],
  );
});

test("drop-target identity ignores equivalent previews", () => {
  const target = { id: "shown-a", placement: "before" };
  assert.equal(sameDropTarget(target, { id: "shown-a", placement: "before" }), true);
  assert.equal(sameDropTarget(target, { id: "shown-a", placement: "after" }), false);
  assert.equal(sameDropTarget(null, null), true);
  assert.equal(sameDropTarget(target, null), false);
});

test("selected models reorder from a dedicated handle, not the copyable id", () => {
  // The handle is the only drag source so selecting an id still copies it.
  assert.match(pickerSource, /useModelReorder\(visibleChosen, setModels, \(\) => props\.busy\)/);
  assert.match(pickerSource, /provider-chosen-reorder/);
  assert.match(pickerSource, /IconGripVertical/);
  assert.match(pickerSource, /settings\.reorderModel/);
  assert.match(pickerSource, /onHandleDragStart\(binding\.id, \$event\)/);
  assert.match(pickerSource, /onRowDrop\(binding\.id, \$event\)/);
  assert.doesNotMatch(pickerSource, /provider-chosen-row-id[\s\S]*draggable/);
  assert.match(styles, /\.provider-chosen-reorder\s*\{/);
  assert.match(styles, /\.provider-chosen-row\.is-dragging\s*\{/);
  assert.match(styles, /\.provider-chosen-row\[data-drop-placement\]::after/);
});
