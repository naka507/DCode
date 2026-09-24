import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  STYLE_BINDING_ALLOWLIST,
  braceBodies,
  rendererRoot,
  splitEntries,
  styleReferenceBody,
  styleReferences,
  styleSpreads,
  styleUnitFindings,
  templateStyleObjects,
  unitlessLengths,
  vueFiles,
} from "./helpers/style-units.mjs";

/**
 * Inline-style unit contract.
 *
 * Vue assigns an object style binding to CSSOM property by property
 * (`style.top = value`), and CSSOM drops a unitless length for a length
 * property **without any error**. React, which this renderer's markup was
 * translated from, appends `px` to a numeric length itself, so a number that
 * rendered correctly there renders nothing here.
 *
 * That is not hypothetical. `Sidebar.vue` bound `{ top: menuPosition.top }` on a
 * `position: fixed` menu, so no `top` was ever written and every sidebar row
 * menu painted at the bottom of the document — off-screen — for both the
 * left-click and right-click paths, which share one `menuPosition`.
 * `FontFamilyRow.vue` lost every windowed-row offset and stacked all rows at
 * the top of the list, and `SessionHoverCard.vue` lost its placement too.
 *
 * The parsers live in `helpers/style-units.mjs` and are unit-tested below,
 * because a guard that silently stops matching passes forever.
 */

const vueFilePaths = vueFiles();

test("the renderer contract surface is not empty", () => {
  // If the walk stops finding `.vue` files, every assertion below passes
  // vacuously.
  assert.ok(
    vueFilePaths.some((path) => path.replace(/\\/g, "/").endsWith("components/Sidebar.vue")),
    "Sidebar.vue must be part of the scan",
  );
});

test("no style binding writes a unitless length", () => {
  const failures = [];
  const unverified = [];
  for (const path of vueFilePaths) {
    const relative = path.slice(rendererRoot.length).replace(/\\/g, "/");
    const { findings, unresolved } = styleUnitFindings(path);
    for (const hit of findings) {
      failures.push(`${relative}:${hit.line}  ${hit.key}: ${hit.value}`);
    }
    for (const hit of unresolved) {
      unverified.push(`${relative}:${hit.line}  ${hit.name}`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    `A length property without a unit renders nothing (CSSOM drops it silently):\n  ${failures.join("\n  ")}`,
  );
  assert.deepEqual(
    unverified,
    [],
    `The values behind these bindings could not be read, so their units are unverified:\n  ${unverified.join("\n  ")}`,
  );
});

test("the scan reaches the helper-shaped bindings it must cover", () => {
  // A `:style="fn(args)"` binding is invisible to a scanner that only reads
  // inline objects and bare identifiers, so assert the resolver actually
  // reaches the two rewritten helpers instead of trusting the clean scan above.
  const source = readFileSync(`${rendererRoot}components/settings/FontFamilyRow.vue`, "utf8");
  const names = styleReferences(source).map((reference) => reference.name);
  assert.ok(names.includes("viewportStyle"), "the viewport binding is seen");
  assert.ok(names.includes("groupRowStyle"), "the group-row binding is seen");
  assert.ok(names.includes("optionRowStyle"), "the option-row binding is seen");
  for (const name of ["viewportStyle", "groupRowStyle", "optionRowStyle"]) {
    assert.ok(styleReferenceBody(source, name), `${name} must resolve to its declaration`);
  }
});

test("the allowlist is exhaustive and documents its reason", () => {
  const entries = Object.entries(STYLE_BINDING_ALLOWLIST);
  assert.ok(entries.length > 0, "the allowlist must not be empty while a file needs it");
  for (const [relative, entry] of entries) {
    assert.ok(entry.reason.length > 40, `${relative} must explain why it is exempt`);
    assert.ok(Array.isArray(entry.shorthands), `${relative} lists its shorthands`);
    assert.ok(Array.isArray(entry.spreads), `${relative} lists its spreads`);
    // The file must still exist, so a rename cannot leave a dead exemption.
    assert.ok(
      vueFilePaths.some((path) => path.slice(rendererRoot.length).replace(/\\/g, "/") === relative),
      `${relative} must exist`,
    );
  }
});

test("the sidebar menus bind a unit-bearing style", () => {
  // The regression that motivated this contract, asserted directly so the test
  // names the surface even if the generic scan is ever narrowed.
  const sidebar = readFileSync(`${rendererRoot}components/Sidebar.vue`, "utf8");
  const template = sidebar.slice(sidebar.indexOf("<template>"));
  assert.doesNotMatch(
    template,
    /:style="\{[^"]*top:\s*menuPosition/,
    "the sidebar menus must not bind raw pixel numbers",
  );
  assert.equal(
    (template.match(/:style="menuStyle"/g) ?? []).length,
    3,
    "all three sidebar menus bind the unit-bearing style",
  );
  assert.match(
    sidebar,
    /top: `\$\{menuPosition\.value\.top\}px`/,
    "menuStyle carries the px unit",
  );
});

test("the font list binds unit-bearing row offsets", () => {
  const source = readFileSync(`${rendererRoot}components/settings/FontFamilyRow.vue`, "utf8");
  assert.doesNotMatch(source, /top: layout\.offsets\[/, "row offsets must not bind raw numbers");
  assert.doesNotMatch(source, /height: layout\.totalHeight/, "the viewport must not bind a raw number");
  assert.match(source, /top: `\$\{layout\.value\.offsets\[row\.index\]\}px`/);
  assert.match(source, /height: `\$\{layout\.value\.totalHeight\}px`/);
});

test("the session hover card binds unit-bearing placement", () => {
  const source = readFileSync(`${rendererRoot}features/sessions/SessionHoverCard.vue`, "utf8");
  assert.doesNotMatch(source, /\.\.\.position, visibility/, "the card must not spread raw numbers");
  assert.match(source, /top: `\$\{position\.value\.top\}px`/);
  assert.match(source, /left: `\$\{position\.value\.left\}px`/);
});

/**
 * The parsers below decide whether the scan above can be trusted, so they are
 * exercised against the shapes the tree uses and the shapes that would defeat a
 * naive split.
 */

test("splitEntries splits only at top-level commas", () => {
  assert.deepEqual(splitEntries("a: 1, b: 2"), ["a: 1", " b: 2"]);
  assert.deepEqual(splitEntries("transform: `translate(-50%, -50%)`, top: 1"), [
    "transform: `translate(-50%, -50%)`",
    " top: 1",
  ]);
  assert.deepEqual(splitEntries('fontFamily: "Segoe UI, sans-serif", top: 1'), [
    'fontFamily: "Segoe UI, sans-serif"',
    " top: 1",
  ]);
  assert.deepEqual(splitEntries("...(x ? { top: 1 } : {}), left: 2"), [
    "...(x ? { top: 1 } : {})",
    " left: 2",
  ]);
});

test("braceBodies returns balanced bodies and ignores braces in strings", () => {
  assert.deepEqual(braceBodies("menuPosition ? { top: 1 } : undefined"), [" top: 1 "]);
  assert.deepEqual(braceBodies("{ a: `}`, b: 1 }"), [" a: `}`, b: 1 "]);
  assert.deepEqual(braceBodies("undefined"), []);
});

test("unitlessLengths flags length properties and nothing else", () => {
  assert.deepEqual(unitlessLengths("top: menuPosition.top, left: menuPosition.left"), [
    { key: "top", value: "menuPosition.top" },
    { key: "left", value: "menuPosition.left" },
  ]);
  assert.deepEqual(unitlessLengths("top: 6, right: 6, height: FONT_ROW_HEIGHT"), [
    { key: "top", value: "6" },
    { key: "right", value: "6" },
    { key: "height", value: "FONT_ROW_HEIGHT" },
  ]);
  // Units, functions, keywords, `0` and non-length properties all pass.
  assert.deepEqual(unitlessLengths("top: '8px', left: `${x}px`, width: '50%'"), []);
  assert.deepEqual(unitlessLengths("width: calc(100% - 2px), height: max(0px, 1vh)"), []);
  assert.deepEqual(unitlessLengths("height: auto, minHeight: fit-content, top: 0"), []);
  assert.deepEqual(unitlessLengths("fontFamily: Inter, color: 'red'"), []);
  // A custom property is a multiplier or a token, not a length.
  assert.deepEqual(unitlessLengths("'--stagger': Math.min(index, 8), '--count': 3"), []);
  // An absent value removes the property, so there is no unit to get wrong.
  assert.deepEqual(unitlessLengths("fontFamily: row.option.family || undefined"), []);
});

test("a JavaScript method is not mistaken for the CSS function", () => {
  // `Math.max(...)` interpolated into a length is a unitless number; the CSS
  // `max()` of the same spelling is a function that yields one.
  assert.deepEqual(unitlessLengths("height: `${Math.max(a, b)}`"), [
    { key: "height", value: "`${Math.max(a, b)}`" },
  ]);
  assert.deepEqual(unitlessLengths("width: Math.max(a, b)"), [
    { key: "width", value: "Math.max(a, b)" },
  ]);
  assert.deepEqual(unitlessLengths("width: min(320px, 100vw)"), []);
  assert.deepEqual(unitlessLengths("height: max(0px, 1vh), minHeight: clamp(0px, 1vh, 10px)"), []);
  // In JavaScript source `%` is modulo, not a percentage.
  assert.deepEqual(unitlessLengths("top: index % 2"), [{ key: "top", value: "index % 2" }]);
  assert.deepEqual(unitlessLengths("width: `${progress}%`"), []);
});

test("a shorthand length property is reported", () => {
  // `{ width }` names a length property without showing its value, so the units
  // cannot be proven from the source.
  assert.deepEqual(unitlessLengths("width"), [{ key: "width", value: "(shorthand)" }]);
  assert.deepEqual(unitlessLengths("width, color"), [{ key: "width", value: "(shorthand)" }]);
  assert.deepEqual(unitlessLengths("color"), []);
});

test("a unit is not detected inside an identifier", () => {
  // `Inter` must not pass by ending in `in`; `HEIGHT` must not pass via `pt`.
  assert.deepEqual(unitlessLengths("fontFamily: Inter"), []);
  assert.deepEqual(unitlessLengths("height: FONT_OPTION_ROW_HEIGHT"), [
    { key: "height", value: "FONT_OPTION_ROW_HEIGHT" },
  ]);
  assert.deepEqual(unitlessLengths("width: POINT_SIZE"), [{ key: "width", value: "POINT_SIZE" }]);
  // A literal `%` still counts as a unit; an interpolation alone does not.
  assert.deepEqual(unitlessLengths("width: `${progress}%`"), []);
  assert.deepEqual(unitlessLengths("width: `${progress}`"), [
    { key: "width", value: "`${progress}`" },
  ]);
});

test("templateStyleObjects reads every binding shape in the tree", () => {
  const single = templateStyleObjects(
    `<template>\n  <div :style="{ top: a.top, left: a.left }" />\n</template>`,
  );
  assert.equal(single.length, 1);
  assert.deepEqual(unitlessLengths(single[0].body), [
    { key: "top", value: "a.top" },
    { key: "left", value: "a.left" },
  ]);

  // A ternary whose object spans lines, as `FontFamilyRow.vue` writes it.
  const multiline = templateStyleObjects(
    [
      "<template>",
      "  <div",
      '    :style="',
      "      menuPosition",
      "        ? { top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }",
      "        : undefined",
      '    "',
      "  />",
      "</template>",
    ].join("\n"),
  );
  assert.equal(multiline.length, 1);
  assert.deepEqual(unitlessLengths(multiline[0].body), []);

  // A spread of a positioned value, as `SessionHoverCard.vue` wrote it: the
  // entry text alone cannot show units, so it is reported for review. The same
  // goes for a spread hidden behind an expression.
  const spread = templateStyleObjects(
    `<template>\n  <div :style="{ ...position, visibility: 'visible' }" />\n</template>`,
  );
  assert.deepEqual(styleSpreads(spread[0].body), ["...position"]);
  // A spread whose object body is inline is already scanned by braceBodies, so
  // reporting it here as well would be a duplicate.
  assert.deepEqual(styleSpreads("...(x ? y : z)"), ["...(x ? y : z)"]);
  assert.deepEqual(styleSpreads("...(x ? { top: 1 } : {})"), []);
});

test("styleReferenceBody reaches a computed object and a ternary arrow", () => {
  const source = [
    "const menuStyle = computed(() =>",
    "  menuPosition.value",
    "    ? { top: `${menuPosition.value.top}px` }",
    "    : undefined,",
    ");",
    "",
    "const other = 1;",
  ].join("\n");
  const body = styleReferenceBody(source, "menuStyle");
  assert.ok(body, "the declaration must be found");
  assert.deepEqual(braceBodies(body).flatMap(unitlessLengths), []);

  const bad = [
    "const cardStyle = computed(() => ({",
    "  top: position.value.top,",
    "  left: position.value.left,",
    "}));",
    "",
    "const next = 2;",
  ].join("\n");
  const badBody = styleReferenceBody(bad, "cardStyle");
  assert.ok(badBody, "the declaration must be found");
  assert.deepEqual(braceBodies(badBody).flatMap(unitlessLengths), [
    { key: "top", value: "position.value.top" },
    { key: "left", value: "position.value.left" },
  ]);

  assert.equal(styleReferenceBody(source, "absent"), null);
});

test("the scan fails on the exact binding that shipped the bug", () => {
  // Reverse verification: the pre-fix text must be reported, so this contract
  // cannot pass by being blind to the original defect.
  const preFix = `<template>\n  <div class="sidebar-floating-menu" :style="{ top: menuPosition!.top, left: menuPosition!.left }" />\n</template>`;
  assert.deepEqual(
    templateStyleObjects(preFix).flatMap((object) => unitlessLengths(object.body)),
    [
      { key: "top", value: "menuPosition!.top" },
      { key: "left", value: "menuPosition!.left" },
    ],
  );
});

test("a :style that calls a helper is resolved in the script region", () => {
  // `:style="groupRowStyle(row)"` is neither an inline object nor a bare
  // identifier. Missing it would leave two of the three rewritten bindings
  // unchecked, so the reference scan must follow the call to its declaration.
  const source = [
    "<template>",
    '  <div :style="optionRowStyle(row, row.option.family)" />',
    "</template>",
    "<script setup>",
    "const optionRowStyle = (row: FontListRow, family: string) => ({",
    '  position: "absolute" as const,',
    "  top: layout.value.offsets[row.index],",
    "  height: `${FONT_OPTION_ROW_HEIGHT}px`,",
    "});",
    "",
    "const next = 1;",
    "</script>",
  ].join("\n");

  const references = styleReferences(source);
  assert.deepEqual(references, [{ name: "optionRowStyle", kind: "call", line: 2 }]);
  const body = styleReferenceBody(source, "optionRowStyle");
  assert.ok(body, "the arrow declaration must be read");
  assert.deepEqual(braceBodies(body).flatMap(unitlessLengths), [
    { key: "top", value: "layout.value.offsets[row.index]" },
  ]);
});

test("a function declaration style helper is resolved too", () => {
  const source = [
    "<template>",
    '  <div :style="rowStyle(row)" />',
    "</template>",
    "<script setup>",
    "function rowStyle(row: FontListRow) {",
    "  return {",
    "    top: `${row.offset}px`,",
    "  };",
    "}",
    "</script>",
  ].join("\n");
  const body = styleReferenceBody(source, "rowStyle");
  assert.ok(body, "the function declaration must be read");
  assert.deepEqual(braceBodies(body).flatMap(unitlessLengths), []);
});
