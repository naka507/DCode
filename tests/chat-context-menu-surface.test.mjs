import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

/**
 * The transcript context menu's surface wiring.
 *
 * Covers the four surfaces the menu spans, at their current paths, with the
 * syntax-bound assertions noted at the site:
 *
 *  - `ContextMenu.vue` uses `<Teleport to="body">`; the portal target is a
 *    template attribute, not a call.
 *  - Its class is the pair `class="context-menu"` plus
 *    `:class="{ 'is-open': placement }"`.
 *  - `useContextMenu()` lives in `lib/context-menu-state.ts`, because a Vue
 *    template cannot return markup from a composable. The open request
 *    therefore still exists verbatim, and `ContextMenu.vue` is the only
 *    surface.
 *  - The provide/inject pair lives in `lib/transcript-menu-context.ts`; the
 *    provider is a `provideTranscriptMenu` call in `ChatTranscript.vue`.
 *  - The contextmenu handler is bound as `@contextmenu="onContextMenu"`.
 *  - The `.context-menu` style rule is asserted unchanged, `z-index: 60`
 *    included: dcode keeps the body-level menu layer.
 */

const styles = await loadStyles();
const menuStateSource = await readFile(
  new URL("../src/renderer/lib/context-menu-state.ts", import.meta.url),
  "utf8",
);
const menuSource = await readFile(
  new URL("../src/renderer/components/ContextMenu.vue", import.meta.url),
  "utf8",
);
const transcriptMenuSource = await readFile(
  new URL("../src/renderer/lib/transcript-menu-context.ts", import.meta.url),
  "utf8",
);
const transcriptSource = await readFile(
  new URL("../src/renderer/features/chat/transcript/ChatTranscript.vue", import.meta.url),
  "utf8",
);
const messageRowSource = await readFile(
  new URL("../src/renderer/features/chat/transcript/MessageRow.vue", import.meta.url),
  "utf8",
);
const assistantTurnSource = await readFile(
  new URL("../src/renderer/features/chat/transcript/AssistantTurn.vue", import.meta.url),
  "utf8",
);

test("the pointer-anchored menu teleports, measures, and closes without trapping focus", () => {
  assert.match(menuSource, /<Teleport to="body">/);
  assert.match(menuSource, /placeContextMenu\(/);
  assert.match(menuSource, /class="context-menu"/);
  assert.match(menuSource, /:class="\{ 'is-open': placement \}"/);
  assert.match(menuSource, /window\.addEventListener\("pointerdown", onOutside, true\)/);
  assert.match(menuSource, /window\.addEventListener\("keydown", onKeyDown, true\)/);
  assert.match(menuSource, /if \(event\.key === "Tab"\)/);
  assert.match(menuSource, /@contextmenu="onMenuContextMenu"/);
  assert.match(menuStateSource, /function snapshotSelection\(/);
  assert.match(menuStateSource, /live\.isCollapsed/);
  assert.match(menuStateSource, /root\.contains\(anchorNode\)/);
  assert.match(menuStateSource, /root\.contains\(focusNode\)/);
  assert.match(menuSource, /item\.onSelect\(state\.selection\)/);
  assert.match(menuStateSource, /if \(!request\.items\.length\) return;/);
});

test("the transcript owns one menu and each speaking row can open it", () => {
  assert.match(transcriptSource, /provideTranscriptMenu\(openContextMenu\)/);
  assert.match(transcriptSource, /<ContextMenu :state="contextMenu"/);
  assert.match(transcriptSource, /@contextmenu="onContextMenu"/);
  assert.match(transcriptSource, /conversationMenuItems\(/);
  assert.match(transcriptMenuSource, /useTranscriptMenu\(\)/);
  assert.match(transcriptMenuSource, /useChatTextActions\(\)/);
  assert.match(messageRowSource, /@contextmenu="onContextMenu"/);
  assert.match(messageRowSource, /userMessageMenuItems\(/);
  assert.match(assistantTurnSource, /@contextmenu="onContextMenu"/);
  assert.match(assistantTurnSource, /assistantTurnMenuItems\(/);
});

test("the context-menu surface is a measured fixed layer", () => {
  const rule = styles.match(/\.context-menu\s*\{[\s\S]*?\}/)?.[0] ?? "";
  assert.match(rule, /position:\s*fixed/);
  assert.match(rule, /z-index:\s*60/);
  assert.match(rule, /visibility:\s*hidden/);
  assert.match(styles, /\.context-menu\.is-open\s*\{[\s\S]*?visibility:\s*visible/);
});
