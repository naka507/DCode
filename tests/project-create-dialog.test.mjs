import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readMainSource } from "./helpers/main-source.mjs";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const {
  appendProjectFolders,
  folderName,
  folderParent,
  orderProjectFolders,
  sameProjectPath,
} = await import("../src/renderer/lib/project-folders.ts");

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
// The main-process assertions in the guard test only need the concatenated
// main sources the other contract tests already use.
const main = await readMainSource();

test("folder name and parent are read from either separator", () => {
  assert.equal(folderName("C:\\work\\repo"), "repo");
  assert.equal(folderName("/home/dev/repo/"), "repo");
  assert.equal(folderName("repo"), "repo");
  assert.equal(folderParent("C:\\work\\repo"), "…/work");
  assert.equal(folderParent("/home/dev/repo/"), "…/dev");
  // A single-segment path has no parent to hint at, so it stands in for itself.
  assert.equal(folderParent("repo"), "repo");
});

test("the same directory picked twice through different spellings is one folder", () => {
  assert.equal(sameProjectPath("C:\\work\\repo", "C:/work/repo"), true);
  assert.equal(sameProjectPath("C:/work/repo/", "C:/work/repo"), true);
  assert.equal(sameProjectPath("C:/work/repo", "C:/work/other"), false);
});

test("folder picks de-duplicate and keep the primary root first", () => {
  const { orderedFolders, primary } = orderProjectFolders(
    ["C:/work/other", "C:/work/repo", "C:\\work\\repo\\"],
    "C:/work/repo",
  );
  assert.deepEqual(orderedFolders, ["C:/work/repo", "C:/work/other"]);
  assert.equal(primary, "C:/work/repo");
});

test("the first folder leads when no primary is named", () => {
  const { orderedFolders, primary } = orderProjectFolders(["C:/a", "C:/b"]);
  assert.deepEqual(orderedFolders, ["C:/a", "C:/b"]);
  assert.equal(primary, "C:/a");
});

test("a primary the user removed falls back to the first surviving folder", () => {
  const { orderedFolders, primary } = orderProjectFolders(["C:/b", "C:/c"], "C:/gone");
  assert.deepEqual(orderedFolders, ["C:/b", "C:/c"]);
  assert.equal(primary, "C:/b");
});

test("an empty or blank folder list has no primary (the dialog stays disabled)", () => {
  assert.deepEqual(orderProjectFolders([]), { orderedFolders: [], primary: null });
  assert.deepEqual(orderProjectFolders(["   ", ""]), {
    orderedFolders: [],
    primary: null,
  });
});

test("a git checkout goes through the same ordering as a folder pick", () => {
  // The store routes a clone through the same helper, so one checkout is a
  // one-folder group whose root is that folder.
  const { orderedFolders, primary } = orderProjectFolders(
    ["C:/clones/repo"],
    "C:/clones/repo",
  );
  assert.deepEqual(orderedFolders, ["C:/clones/repo"]);
  assert.equal(primary, "C:/clones/repo");
});

test("appending picks skips directories already in the list", () => {
  assert.deepEqual(appendProjectFolders(["C:/a"], ["C:/a/", "C:/b"]), ["C:/a", "C:/b"]);
  assert.deepEqual(appendProjectFolders([], ["C:/a"]), ["C:/a"]);
  assert.deepEqual(appendProjectFolders(["C:/a"], []), ["C:/a"]);
});

test("project folder pickers ignore repeated requests while a dialog is open", async () => {
  const [createDialog, editDialog] = await Promise.all([
    read("../src/renderer/components/ProjectCreateDialog.vue"),
    read("../src/renderer/components/ProjectEditDialog.vue"),
  ]);
  for (const source of [createDialog, editDialog]) {
    assert.match(source, /const folderPickerInFlightRef = ref\(false\)/);
    assert.match(
      source,
      /if \(busy\.value \|\| folderPickerInFlightRef\.value\) return;/,
    );
    assert.match(
      source,
      /folderPickerInFlightRef\.value = true;\s*folderPickerBusy\.value = true;[\s\S]*?api\.pickProjectFolders\(\)/,
    );
    assert.match(
      source,
      /folderPickerInFlightRef\.value = false;\s*folderPickerBusy\.value = false;/,
    );
  }
  assert.match(main, /let projectPickerActive = false/);
  assert.match(main, /const openProjectPicker = async/);
  assert.match(main, /if \(!result \|\| result\.canceled/);
  assert.match(main, /const owner = getMainWindow\(\)/);
});
