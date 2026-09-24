import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

/**
 * Covers the home hero's project switcher. The assertions name the Vue
 * component's own syntax:
 *
 *   - the guard is a `ref(false)` beside the rendered `busy` flag (see the
 *     component header), so the pair is `busyRef.value` / `busy.value`.
 *   - the empty home hero renders `<HomeProjectSwitcher ... />` rather than a
 *     folder-picker button, which is what the assertion actually guards.
 */

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [chatSurface, switcher, styles] = await Promise.all([
  read("../src/renderer/components/ChatSurface.vue"),
  read("../src/renderer/components/HomeProjectSwitcher.vue"),
  loadStyles(),
]);

test("empty-home project name opens a switcher instead of the folder picker", () => {
  assert.match(chatSurface, /<HomeProjectSwitcher/);
  assert.match(chatSurface, /:name="heroProject"/);
  const emptyStart = chatSurface.indexOf('data-testid="home-empty"');
  const emptyEnd = chatSurface.indexOf("<SessionPane", emptyStart);
  const emptyBlock = chatSurface.slice(emptyStart, emptyEnd);
  assert.doesNotMatch(emptyBlock, /@click="[^"]*openProject\(\)"/);
  assert.match(emptyBlock, /<HomeProjectSwitcher[\s\S]*?\/>/);
});

test("home project switcher lists sidebar projects and can clone a git repo", () => {
  assert.match(switcher, /<AnchoredMenu/);
  assert.match(switcher, /listSwitcherProjects/);
  assert.match(switcher, /project\.searchPlaceholder/);
  assert.match(switcher, /newSession\(\{ projectPath: nextPath \}\)/);
  assert.match(switcher, /cloneProject/);
  assert.match(switcher, /parseGitCloneUrl/);
  assert.match(switcher, /project\.clone/);
  assert.match(switcher, /project\.open/);
  assert.match(switcher, /await store\.appState\?\.openProject\(\)/);
  assert.match(switcher, /data-testid="home-project-switcher"/);
  assert.match(switcher, /aria-haspopup="menu"/);
  assert.match(switcher, /initial-focus="input"/);
});

test("home project switcher guards project operations before Vue rerenders", () => {
  assert.match(switcher, /const busyRef = ref\(false\)/);
  assert.match(switcher, /if \(busy\.value \|\| busyRef\.value\) return;/);
  assert.match(switcher, /busyRef\.value = true;\s*busy\.value = true/);
  assert.match(switcher, /busyRef\.value = false;\s*busy\.value = false/);
});

test("home project switcher is a fixed portaled menu that stays inline in the hero", () => {
  assert.match(
    styles,
    /\.empty-hero \.home-project-switcher \{[\s\S]*?display:\s*inline-block;/,
  );
  assert.match(
    styles,
    /\.home-project-switcher-menu \{[\s\S]*?position:\s*fixed;/,
  );
  assert.match(
    styles,
    /\.home-project-switcher-menu\.is-open \{[\s\S]*?visibility:\s*visible;/,
  );
});
