/**
 * The renderer's mount element must be the element the shell CSS sizes.
 *
 * `base.css` starts the full-height chain with `html, body, #<mount>`; the
 * stylesheets expect the mount element the entry HTML used (`#root`), while the
 * entry HTML and boot code mount into `#app`. Nothing referenced the
 * mismatch, so every rule that relies on the chain silently stopped applying:
 * `.app-shell { height: 100% }` resolved against an auto-height parent and the
 * whole shell collapsed to its content height (204px in an 800px window) with
 * the composer parked under the hero instead of at the bottom of the pane.
 *
 * These guards are deliberately name-agnostic: they assert the mount id, the
 * boot code and the stylesheets all agree, so either side may be renamed as
 * long as the other follows.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadStylesSync } from "./helpers/styles.mjs";

const INDEX_HTML = new URL("../src/renderer/index.html", import.meta.url);
const MAIN_TS = new URL("../src/renderer/main.ts", import.meta.url);

/** The only two ids this app has ever used for the mount element. */
const MOUNT_IDS = ["root", "app"];

/** The empty `<div id="...">` the renderer is mounted into. */
function mountId() {
  const html = readFileSync(INDEX_HTML, "utf8");
  const match = html.match(/<div id="([A-Za-z][\w-]*)"><\/div>/);
  assert.ok(match, "src/renderer/index.html declares no empty mount div");
  return match[1];
}

/** The id the boot code looks up, i.e. where Vue actually mounts. */
function bootMountId() {
  const source = readFileSync(MAIN_TS, "utf8");
  const match = source.match(/getElementById\("([A-Za-z][\w-]*)"\)/);
  assert.ok(match, "src/renderer/main.ts does not look up a mount element");
  return match[1];
}

test("the boot code mounts into the element index.html declares", () => {
  assert.equal(bootMountId(), mountId());
});

test("base.css gives the mount element a full-height chain", () => {
  const id = mountId();
  const styles = loadStylesSync();
  // The exact prelude of the `height: 100%` rule that starts the chain.
  assert.match(
    styles,
    new RegExp(`html,\\nbody,\\n#${id} \\{\\n {2}height: 100%;`),
    `base.css must size #${id} (the mount element) to height: 100%`,
  );
});

test("no stylesheet targets a mount element other than the real one", () => {
  const id = mountId();
  const styles = loadStylesSync();
  const strays = MOUNT_IDS.filter(
    (candidate) => candidate !== id && new RegExp(`#${candidate}\\b`).test(styles),
  );
  assert.deepEqual(
    strays,
    [],
    `the stylesheets target #${strays.join(", #")} but the renderer mounts into #${id}; ` +
      "the full-height chain and the macOS vibrancy rules would stop applying",
  );
});
