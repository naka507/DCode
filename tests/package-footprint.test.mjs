import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * The packaged `app.asar` carried 81 MB of `node_modules`, of which most was
 * never reachable from the running app: type declarations, package
 * documentation, and the `esbuild` build tool that only
 * `@earendil-works/chord`'s plugin-authoring path imports. `build.files` is
 * the only switch that trims them, and its failure mode is silent — a
 * dropped or misspelled negation simply restores the weight, and every other
 * gate stays green.
 *
 * Two properties are load-bearing and pinned here:
 *
 * 1. **Every negation is anchored to `node_modules`.** A bare `.d.ts` glob
 *    would also strip the renderer's own assets, and an unscoped docs glob
 *    would delete nothing that matters while an unscoped test glob can match
 *    `out/`. The anchor is what keeps `out/**` — the only thing the app
 *    actually runs — untouchable.
 * 2. **The runtime externals survive.** `electron.vite.config.ts` keeps
 *    `electron-updater`, `jiti` and `jiti/static` outside the bundle, so they
 *    must still be resolvable from the packaged tree. A negation that
 *    swallowed them would only fail on a user's machine, at the first update
 *    check or the first trusted-extension load.
 */

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

const files = packageJson.build.files;

test("build.files keeps out/** and package.json as the positive entries", () => {
  const positives = files.filter((entry) => !entry.startsWith("!"));
  assert.deepEqual(
    positives,
    ["out/**/*", "package.json"],
    "the packaged tree is the built app plus its package.json; everything else is a negation",
  );
});

test("every node_modules negation is anchored to node_modules", () => {
  // A negation that is not scoped to node_modules can reach `out/**`, which is
  // the whole application. The two pre-existing exceptions are the source-map
  // and test-file rules, which are deliberately tree-wide.
  const treeWide = new Set([
    "!**/*.map",
    "!**/node_modules/**/*.{test,spec}.{js,cjs,mjs}",
  ]);
  const unscoped = files.filter(
    (entry) =>
      entry.startsWith("!") &&
      !treeWide.has(entry) &&
      !entry.startsWith("!**/node_modules/") &&
      // The original rule is `!**/node_modules/*/{...}/**` (single star), which
      // scopes to a package's own top-level test directory rather than any
      // nested one.
      !entry.startsWith("!**/node_modules/*/"),
  );
  assert.deepEqual(
    unscoped,
    [],
    "a negation outside node_modules can delete part of out/**; anchor it",
  );
});

test("the weight-trimming negations are present", () => {
  const required = [
    "!**/node_modules/**/*.d.ts",
    "!**/node_modules/**/*.d.mts",
    "!**/node_modules/**/*.d.cts",
    "!**/node_modules/**/docs/**",
    "!**/node_modules/@esbuild/**",
    "!**/node_modules/esbuild/**",
  ];
  for (const entry of required) {
    assert.ok(
      files.includes(entry),
      `${entry} is what keeps the packaged node_modules from carrying the build tool and the type surface`,
    );
  }
});

test("no negation removes a runtime external or the renderer assets", () => {
  // These are the paths that must survive. The check is textual and
  // deliberately conservative: a negation matching one of these substrings
  // would be a regression, whether or not the pattern is exact.
  const protectedPaths = [
    "out/renderer/assets",
    "electron-updater",
    "jiti",
  ];
  for (const entry of files) {
    if (!entry.startsWith("!")) continue;
    for (const guarded of protectedPaths) {
      assert.ok(
        !entry.includes(guarded),
        `${entry} must not name ${guarded}`,
      );
    }
  }
});

test("the esbuild negation targets the package, not the string", () => {
  // `!**/esbuild/**` would also match any directory named esbuild anywhere,
  // including a future `out/.../esbuild/` chunk. The negations name the two
  // package roots instead.
  const esbuildEntries = files.filter((entry) => entry.includes("esbuild"));
  assert.deepEqual(
    esbuildEntries.sort(),
    ["!**/node_modules/@esbuild/**", "!**/node_modules/esbuild/**"],
    "esbuild is a build-time dependency of @earendil-works/chord; only its package roots are excluded",
  );
});
