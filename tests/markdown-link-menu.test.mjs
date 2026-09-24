import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Chat link context menu.
 *
 * `components/Markdown.vue`'s `Anchor` render function is the same code in
 * `h()` form, so the assertions are written against Vue syntax and otherwise
 * unchanged:
 *
 *  - `useContextMenu()` plus the `h(ContextMenu, { state: …, onClose: … })`
 *    call in the `Anchor` render function.
 *  - `openContextMenu(event, {` and the three item ids are literal and unchanged.
 *  - `await navigator.clipboard.writeText(target)`, where `target` is the `href`
 *    captured before the menu opened.
 *  - This tree carries only `en` and `zh-CN`, so the equivalent negative check
 *    reads `en`.
 */

const markdownSource = await readFile(
  new URL("../src/renderer/components/Markdown.vue", import.meta.url),
  "utf8",
);
const englishCatalog = await readFile(
  new URL("../src/i18n/locales/en/index.ts", import.meta.url),
  "utf8",
);

test("chat links use the shared pointer-anchored menu", () => {
  assert.match(markdownSource, /useContextMenu\(\)/);
  assert.match(markdownSource, /h\(ContextMenu, \{/);
  assert.match(markdownSource, /state: contextMenu\.value/);
  assert.match(markdownSource, /onClose: closeContextMenu/);
  assert.match(markdownSource, /openContextMenu\(event, \{/);
  assert.match(markdownSource, /id: "open-external"/);
  assert.match(markdownSource, /id: "open-workpanel"/);
  assert.match(markdownSource, /id: "copy-address"/);
});

test("copy link feedback follows the clipboard result", () => {
  assert.match(markdownSource, /await navigator\.clipboard\.writeText\(target\)/);
  assert.match(markdownSource, /t\("settings\.linkCopied"/);
  assert.match(markdownSource, /t\("settings\.linkCopyFailed"/);
  assert.doesNotMatch(
    markdownSource,
    /void navigator\.clipboard\.writeText\([^)]+\);\s*showToast\(/,
  );
});

test("the link menu copy ships in the English catalog", () => {
  assert.match(englishCatalog, /linkContextMenuOpenExternal:/);
  assert.match(englishCatalog, /linkContextMenuOpenWorkpanel:/);
  assert.match(englishCatalog, /linkContextMenuCopy:/);
});
