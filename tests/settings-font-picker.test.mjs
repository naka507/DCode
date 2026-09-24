/**
 * Font picker contract.
 *
 * The assertions read the SFC and the composed stylesheet, so every case stands
 * on its own. Notes, each also recorded at its site:
 *
 *  - `createPortal(menu, document.body)` → `<Teleport to="body">`; the menu is
 *    `v-if`-gated on `open`, so it mounts and unmounts with the same timing as
 *    the portal did.
 *  - `useRef` reads are `.value` reads, and `listRef.current?.querySelector` —
 *    which must not exist — is asserted by its Vue spelling.
 *  - `const defaultLabel = t("settings.fontSystemDefault")` is a `computed`,
 *    so the assertion accepts the `computed(() => t(...))` wrapper.
 *  - `{ fontFamily: value } : { fontFamily: "" }` keeps the same shape; the
 *    Vue call is `props.saveSettings(...)` because `saveSettings` is a prop.
 *
 * The final case is the one `fb37f9c2` (ADR 0298) added when the bundled faces
 * were withdrawn: the picker has no bundled group, no license badge, and no
 * `settings.fontBundled` copy.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const rowSource = await readFile(
  new URL("../src/renderer/components/settings/FontFamilyRow.vue", import.meta.url),
  "utf8",
);
const styles = await loadStyles();

test("font picker menu portals to the body so the settings card cannot clip it", () => {
  assert.match(rowSource, /<Teleport[^>]*to="body"/);
  assert.match(styles, /\.settings-font-menu\s*\{[^}]*position:\s*fixed;/s);
  assert.match(styles, /\.settings-font-menu\.is-open\s*\{/);
  assert.doesNotMatch(
    styles,
    /\.settings-font-menu\s*\{[^}]*position:\s*absolute;/s,
  );
});

test("selecting System default persists an empty stack so the override clears", () => {
  assert.match(
    rowSource,
    /saveSettings\(value \? \{ fontFamily: value \} : \{ fontFamily: "" \}\)/,
  );
  assert.doesNotMatch(rowSource, /fontFamily: undefined/);
});

test("the closed trigger and search use the localized system-default label", () => {
  assert.match(
    rowSource,
    /const defaultLabel = computed\(\(\) => t\("settings\.fontSystemDefault"\)\)/,
  );
  assert.match(
    rowSource,
    /selectedOption\.value\?\.group === "default" \|\| selectedValue\.value === ""/,
  );
  assert.match(
    rowSource,
    /option\.group === "default"[\s\S]*?`\$\{defaultLabel\.value\} \$\{option\.label\}`\.toLowerCase\(\)/,
  );
});

test("the font trigger hugs the current label like language and theme", () => {
  assert.match(
    styles,
    /\.settings-language-anchor,\s*\.settings-theme-anchor,\s*\.settings-menu-select-anchor,\s*\.settings-font\s*\{[^}]*width:\s*max-content/s,
  );
  assert.match(
    styles,
    /\.settings-language-trigger,\s*\.settings-theme-trigger,\s*\.settings-menu-select-trigger,\s*\.settings-font-trigger\s*\{[^}]*width:\s*max-content/s,
  );
  assert.match(
    styles,
    /\.settings-language-trigger-label,\s*\.settings-theme-trigger-label,\s*\.settings-menu-select-trigger-label,\s*\.settings-font-trigger-label\s*\{[^}]*flex:\s*0 1 auto/s,
  );
  assert.doesNotMatch(styles, /\.settings-font-trigger\s*\{[^}]*min-width:\s*200px;/s);
});

test("font list windows the rows so only the visible slice is in the DOM", () => {
  assert.match(rowSource, /visibleRowRange\(layout\.value, scrollTop\.value/);
  assert.match(rowSource, /layout\.rows\.slice\(visibleRange\.start, visibleRange\.end\)/);
  assert.match(rowSource, /position: "absolute" as const/);
  assert.match(rowSource, /height: `\$\{FONT_OPTION_ROW_HEIGHT\}px`/);
  assert.match(styles, /\.settings-font-list\s*\{[^}]*position:\s*relative;/s);
  assert.match(styles, /\.settings-font-list\s*\{[^}]*overflow-y:\s*auto;/s);
});

test("the windowed group label still renders its text", () => {
  // The rows are positioned by a style helper now; the label's own content must
  // survive that rewrite, or the groups render as empty boxes.
  const block = /class="settings-font-group-label"[\s\S]*?<\/div>/.exec(rowSource);
  assert.ok(block, "the group label element must exist");
  assert.match(block[0], /\{\{\s*row\.label\s*\}\}/, "the group label renders row.label");
  assert.match(rowSource, /const groupRowStyle = \(row: FontListRow\)/);
});

test("font list never scrolls horizontally", () => {
  assert.match(styles, /\.settings-font-list\s*\{[^}]*overflow-x:\s*hidden;/s);
  // Rows are absolutely positioned with inline left/right insets; a width on
  // them would over-constrain the box, drop `right`, and overflow the list.
  assert.doesNotMatch(styles, /\.settings-font-item\s*\{[^}]*width:\s*100%;/s);
  assert.match(rowSource, /left: "6px",\s*right: "6px",/s);
});

test("highlight scrolling uses the layout offsets instead of scrollIntoView", () => {
  assert.match(rowSource, /layout\.value\.offsets\[rowIndex\]/);
  assert.match(rowSource, /list\.scrollTop = top \+ height - viewport/);
  assert.doesNotMatch(rowSource, /listRef\.value\?\.querySelector/);
});

test("menu repositioning ignores scrolls inside the font list", () => {
  assert.match(rowSource, /menuRef\.value\?\.contains\(target\)/);
});

test("the picker has no bundled group, license badge, or fontBundled copy", () => {
  assert.doesNotMatch(rowSource, /group === "bundled"/);
  assert.doesNotMatch(rowSource, /settings\.fontBundled/);
  assert.doesNotMatch(rowSource, /settings-font-item-license/);
  assert.doesNotMatch(rowSource, /option\.license/);
  assert.doesNotMatch(styles, /\.settings-font-item-license\s*\{/);
});

test("the app ships no font face of its own", async () => {
  // ADR 0298: the four OFL families left with the bundled group, so nothing
  // registers an application @font-face and globals.css imports no font layer.
  // The import line is read from globals.css directly: `loadStyles()` inlines
  // every local `@import`, so `styles` can never contain one — an assertion
  // against it would pass no matter what this tree did.
  assert.doesNotMatch(styles, /font-family:\s*"LXGW WenKai"/);
  assert.doesNotMatch(styles, /assets\/fonts\//);
  const entry = await readFile(
    new URL("../src/renderer/styles/globals.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(entry, /@import "\.\/fonts\.css";/);
  await assert.rejects(
    readFile(new URL("../src/renderer/styles/fonts.css", import.meta.url), "utf8"),
    { code: "ENOENT" },
    "styles/fonts.css must not exist",
  );
});
