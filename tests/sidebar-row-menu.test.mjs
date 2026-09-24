import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Sidebar row-menu behaviour contract.
 *
 * The row menu's items read the selection they act on (`menuSession`,
 * `menuProjectEntry`, `sectionMenu`), and every one of them also closes the
 * menu. `closeMenus` clears those selections, and the three names are
 * `computed`s derived from the cleared refs, so a handler that closes first and
 * reads afterwards sees `undefined` and silently does nothing: the menu
 * disappears and no dialog opens, which reads as a dead menu item.
 *
 * `openRenameDialog`, `openEditProjectDialog` and `runSectionMenuAction`
 * capture the target into a local before closing, and the template binds them
 * rather than inlining the two statements.
 */

const rendererRoot = fileURLToPath(new URL("../src/renderer/", import.meta.url));
const sidebarPath = join(rendererRoot, "components/Sidebar.vue");
const sidebar = readFileSync(sidebarPath, "utf8");
const template = sidebar.slice(sidebar.indexOf("<template>"));

/** The `@click="..."` expression of every element in the template. */
function clickHandlers(source) {
  const handlers = [];
  const re = /@click="([\s\S]*?)"(?=\s|\/?>)/g;
  let match;
  while ((match = re.exec(source))) {
    handlers.push({
      line: source.slice(0, match.index).split("\n").length,
      expression: match[1].trim(),
    });
  }
  return handlers;
}

/** The declarations of the menu item handlers that open a dialog. */
function functionBody(name) {
  const match = new RegExp(`function ${name}\\(\\)[\\s\\S]*?\\n\\}`).exec(sidebar);
  return match ? match[0] : null;
}

test("the scan sees the sidebar template", () => {
  assert.ok(template.length > 10_000, "the template slice must be the real markup");
  assert.ok(clickHandlers(template).length > 20, "expected many click handlers");
});

test("no menu item reads a cleared selection after closing the menu", () => {
  // A handler that closes the menu and then reads one of the derived names in
  // the same expression cannot work; the read is guaranteed to be empty.
  const derived = /\b(menuSession|menuProjectEntry|sectionMenu)\b/;
  const offenders = [];
  for (const { line, expression } of clickHandlers(template)) {
    const close = expression.indexOf("closeMenus");
    if (close < 0) continue;
    const after = expression.slice(close);
    if (derived.test(after)) offenders.push(`Sidebar.vue:${line}  ${expression}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `These handlers close the menu and then read the selection it clears, so they do nothing:\n  ${offenders.join("\n  ")}`,
  );
});

test("the dialog handlers capture their target before closing the menu", () => {
  for (const name of ["openRenameDialog", "openEditProjectDialog"]) {
    const body = functionBody(name);
    assert.ok(body, `${name} must be declared`);
    const capture = body.search(/const \w+ = (menuSession|menuProjectEntry)\.value/);
    const close = body.indexOf("closeMenus(");
    assert.ok(capture >= 0, `${name} must capture its target into a local`);
    assert.ok(close >= 0, `${name} must close the menu`);
    assert.ok(
      capture < close,
      `${name} must capture the target before closeMenus clears the selection`,
    );
  }

  const section = functionBody("runSectionMenuAction");
  assert.ok(section, "runSectionMenuAction must be declared");
  assert.ok(
    section.indexOf("const section = sectionMenu.value") < section.indexOf("closeMenus("),
    "runSectionMenuAction must capture the section before closeMenus clears it",
  );
  // Both branches must still be reachable from the captured value.
  assert.match(section, /section === "sessions"[\s\S]*createSession\(\{ projectPath: null \}\)/);
  assert.match(section, /section === "projects"[\s\S]*openProjectPicker\(\)/);
});

test("the template binds the named handlers instead of inlining the statements", () => {
  const handlers = clickHandlers(template).map((handler) => handler.expression);
  assert.ok(handlers.includes("openRenameDialog"), "the rename item binds openRenameDialog");
  assert.ok(
    handlers.includes("openEditProjectDialog"),
    "the edit-project item binds openEditProjectDialog",
  );
  assert.ok(
    handlers.includes("runSectionMenuAction"),
    "the section-menu item binds runSectionMenuAction",
  );
  // The old inline form must not come back.
  assert.doesNotMatch(template, /closeMenus\(false\);\s*renameFor = menuSession/);
  assert.doesNotMatch(template, /closeMenus\(false\);\s*editProjectFor = menuProjectEntry/);
});

test("the rename and edit dialogs are rendered from the captured refs", () => {
  // The handlers are only useful if the template renders the dialogs from the
  // refs they assign.
  assert.match(template, /<SessionRenameDialog\s+v-if="renameFor"/);
  assert.match(template, /<ProjectEditDialog\s+v-if="editProjectTarget"/);
  assert.match(sidebar, /const editProjectTarget = computed\(\(\) => \{/);
});
