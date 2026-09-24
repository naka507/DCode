import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { hostBinaryCandidates } from "../scripts/e2e/host.mjs";

/**
 * `scripts/e2e-window-controls.mjs` — the E2E-CHROME-window-controls-survive-work-panel
 * runner.
 *
 * A runner is the one artifact in this repository that no other gate can check.
 * `npm test` never executes it (it starts Electron), `vue-tsc` does not read it,
 * and the class contract only reads `.vue` templates. So a runner that queries a
 * selector the renderer stopped rendering, or invokes an IPC channel the
 * protocol no longer declares, fails only when someone runs it against a real
 * app — which per `AGENTS.md` § 12 happens only on explicit request.
 *
 * This file closes that gap for the one runner whose whole point is that a
 * control stays reachable: it pins the runner's own wiring against the three
 * sources that define it — the renderer's markup, the protocol's channel names,
 * and the automation surface.
 */

const root = fileURLToPath(new URL("../", import.meta.url));
const rendererRoot = join(root, "src", "renderer");
const runnerPath = join(root, "scripts", "e2e-window-controls.mjs");
const packagePath = join(root, "package.json");
const readmePath = join(root, "scripts", "README.md");

const runnerSource = readFileSync(runnerPath, "utf8");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const protocolSource = readFileSync(
  join(root, "src", "shared", "protocol.ts"),
  "utf8",
);
const surfaceSource = readFileSync(
  join(rendererRoot, "capture", "renderer-api.ts"),
  "utf8",
);
const hostProcessSource = readFileSync(
  join(root, "src", "main", "host-process.ts"),
  "utf8",
);

/** The host-core binary's file name on this platform. */
const HOST_BINARY_NAME =
  process.platform === "win32" ? "DCore.exe" : "DCore";

/**
 * The methods the *installed* `surface` object wires, not the `RendererApi`
 * type's members. Both spell a method as `name:` and the type comes first in
 * the file, so a whole-file search answers "is this method declared" — true for
 * a method the object never installs, which is the silent no-op this test
 * exists to catch.
 */
const installedSurfaceSource = surfaceSource.slice(
  surfaceSource.indexOf("const surface: RendererApi = {"),
  surfaceSource.indexOf("window.__DCODE__ = surface"),
);

/** Every `.vue` SFC under `src/renderer`. */
function vueSources() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".vue")) files.push(readFileSync(path, "utf8"));
    }
  };
  walk(rendererRoot);
  return files;
}

/**
 * The class tokens and `data-*` bindings the renderer's SFCs can put on an
 * element: every whitespace-separated name in a `class` / `:class` attribute,
 * every string literal inside one (which is where `cx()` calls and the object
 * and array binding forms live), every literal `data-x="y"` attribute as the
 * whole `data-x="y"` string a selector would name, and every string literal in
 * the script block.
 *
 * Deliberately narrower than "any string anywhere under src/renderer".
 * `work-panel` is also a module name, a stylesheet filename and a commit
 * subject, so a whole-tree substring search keeps passing after the root class
 * is renamed — which is the exact false negative this file exists to prevent.
 * `work-panel-maximized` is the token that shows why the script block has to
 * count too: `AppShell.vue` builds it in a `computed` and passes the object
 * through `:class="shellClass"`, so the name never appears in an attribute.
 *
 * This is a rename detector, not a proof that the element renders. It cannot
 * see a binding that is never applied, which is why the runner also asserts the
 * elements it finds are hit-testable at runtime.
 */
function classTokens() {
  const tokens = new Set();
  for (const source of vueSources()) {
    for (const match of source.matchAll(/(?::class|class)="([^"]*)"/g)) {
      for (const token of match[1].split(/\s+/)) {
        if (/^[A-Za-z][\w-]*$/.test(token)) tokens.add(token);
      }
      for (const literal of match[1].matchAll(/["']([A-Za-z][\w-]*)["']/g)) {
        tokens.add(literal[1]);
      }
    }
    // Static data attributes, as the whole `name="value"` a selector names.
    // `:data-*` bindings are dynamic and cannot be checked this way, so they
    // are covered by the script-block literals below instead.
    for (const match of source.matchAll(/(?:^|\s)(data-[\w-]+)="([^"]*)"/g)) {
      tokens.add(`${match[1]}="${match[2]}"`);
    }
    // Class names and attribute values built in a script block and handed over
    // through a binding.
    for (const literal of source.matchAll(/["']([A-Za-z][\w-]*)["']/g)) {
      tokens.add(literal[1]);
    }
  }
  return tokens;
}

/**
 * The selectors the runner hands to `document.querySelector` or to its own
 * `click()` helper. `click()` interpolates through `JSON.stringify`, so only
 * the call sites carry the literal.
 */
function queriedSelectors() {
  const found = new Set();
  for (const match of runnerSource.matchAll(
    /(?:querySelector|click)\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g,
  )) {
    found.add(match[2]);
  }
  return [...found];
}

/**
 * The token a selector addresses, as it appears in the renderer's source:
 * `[data-nav="x"]` -> `data-nav="x"` (the brackets are selector syntax, not
 * markup), and `.window-control-btn:nth-child(2)` -> `window-control-btn`.
 */
function baseToken(selector) {
  const attribute = selector.match(/^\[(.+)\]$/);
  if (attribute) return attribute[1];
  const match = selector.match(/\.([A-Za-z][\w-]*)/);
  return match ? match[1] : null;
}

test("the window-controls runner is registered and documented", () => {
  assert.ok(
    existsSync(runnerPath),
    "scripts/e2e-window-controls.mjs is missing; the e2e runners are " +
      "documented in docs/ARCHITECTURE.md",
  );

  const alias = packageJson.scripts["test:e2e:window-controls"];
  assert.equal(
    alias,
    "node scripts/e2e-window-controls.mjs",
    "the runner needs its own `test:e2e:*` alias; docs/ARCHITECTURE.md " +
      "records the aliases as matching the runners that exist",
  );

  assert.match(
    readFileSync(readmePath, "utf8"),
    /e2e-window-controls\.mjs/,
    "scripts/README.md documents every runner; an undocumented one is " +
      "invisible to the next reader",
  );
});

test("the runner queries selectors the renderer's SFCs actually bind", () => {
  const tokens = classTokens();
  const selectors = queriedSelectors();
  assert.ok(
    selectors.length >= 8,
    `expected the runner to drive the shell's markup; found ${selectors.length} ` +
      `selectors: ${selectors.join(", ")}`,
  );

  const missing = [];
  for (const selector of selectors) {
    const token = baseToken(selector);
    if (token === null) continue;
    if (!tokens.has(token)) missing.push(`${selector} (looked for ${token})`);
  }
  assert.deepEqual(
    missing,
    [],
    "the runner drives selectors no SFC binds, so the checks would throw " +
      `'Missing target' against a live app: ${missing.join(", ")}`,
  );
});

test("the selector check is not vacuous", () => {
  // A guard on the guard: `classTokens()` must not degrade into "accept
  // anything", or the test above passes while the runner rots. Both shapes it
  // has to see are asserted against real names in this tree — a plain class
  // attribute (`WindowControls.vue`) and a name built in a script block
  // (`AppShell.vue`'s `shellClass`).
  const tokens = classTokens();
  for (const token of [
    "window-control-btn",
    "window-controls",
    "work-panel-header",
    "work-panel-maximized",
    "app-work-panel-toggle",
  ]) {
    assert.ok(tokens.has(token), `classTokens() lost \`${token}\``);
  }
  assert.ok(
    !tokens.has("app-work-panel-togglX"),
    "classTokens() accepts a name no SFC binds, so the selector check " +
      "cannot fail and proves nothing",
  );
});

test("the runner drives IPC channels the protocol declares", () => {
  // Read the literals from the runner and confirm each is a real channel: a
  // typo here is rejected by the preload whitelist at runtime, not at build.
  const channels = new Set(
    [...runnerSource.matchAll(/["'](dcode\/[\w/]+)["']/g)].map((m) => m[1]),
  );
  assert.ok(channels.size >= 3, `expected the runner to invoke IPC; found ${channels.size}`);

  const missing = [...channels].filter(
    (channel) => !protocolSource.includes(`"${channel}"`),
  );
  assert.deepEqual(
    missing,
    [],
    `the runner invokes channels the protocol does not declare, so the ` +
      `preload whitelist would reject them: ${missing.join(", ")}`,
  );
});

test("the runner drives automation-surface methods the shell installs", () => {
  const methods = new Set(
    [...runnerSource.matchAll(/__DCODE__\.(\w+)/g)].map((m) => m[1]),
  );
  assert.ok(methods.size >= 2, `expected the runner to drive the surface; found ${methods.size}`);

  // The installed object, not the whole file: `selectSession:` and friends also
  // appear in the `RendererApi` type above it.
  const missing = [...methods].filter(
    (name) => !installedSurfaceSource.includes(`${name}:`),
  );
  assert.deepEqual(
    missing,
    [],
    `the runner calls automation-surface methods that do not exist, so they ` +
      `would silently no-op: ${missing.join(", ")}`,
  );
});

test("the shared host driver resolves the sibling dcore binary", () => {
  // The fold builds host-core in the sibling `dcore` checkout, never inside
  // this repository, and every runner that seeds state through the host calls
  // `resolveHostBinary()`. Without a dcore candidate each of them needs a
  // hand-set DCODE_HOST_BIN, which is what the shared driver exists to
  // avoid — and the failure only appears when a runner is executed.
  //
  // The exact candidates, in order, not a substring: `dcore` appears in the
  // driver's own comments, and a depth-shifted root (`../../../dcore`, which
  // never exists) would still satisfy a `some(includes(...))` check while
  // breaking every caller.
  const expected = [];
  for (const depth of [[".."], ["..", ".."]]) {
    for (const profile of ["debug", "release"]) {
      expected.push(join(root, ...depth, "dcore", "target", profile, HOST_BINARY_NAME));
    }
  }
  const candidates = hostBinaryCandidates();
  for (const candidate of expected) {
    assert.ok(
      candidates.includes(candidate),
      `hostBinaryCandidates() no longer offers ${candidate}, so every runner ` +
        `needs DCODE_HOST_BIN set by hand. Tried: ${candidates.join(", ")}`,
    );
  }

  // The main process resolves the same binary independently, so the two must
  // agree on both the roots *and* the order. Matching the paths rather than the
  // text is what makes this load-bearing: `host-process.ts` carries a comment
  // containing `dcore/target`, so a `/dcore\/target/` match stays green after
  // the real candidates are deleted. Order matters too — if the driver
  // preferred release while the app preferred debug, a machine holding both
  // would seed the throwaway data dir with one host and reopen it with the
  // other.
  const mainSource = hostProcessSource;
  for (const profile of ["debug", "release"]) {
    assert.ok(
      mainSource.includes(`dcore/target/${profile}/DCore`),
      `src/main/host-process.ts no longer resolves host-core from ` +
        `dcore/target/${profile}; the runner driver's candidates must match it`,
    );
  }
  assert.ok(
    mainSource.indexOf("dcore/target/debug/") < mainSource.indexOf("dcore/target/release/"),
    "src/main/host-process.ts no longer prefers the debug host-core, so the " +
      "driver's debug-before-release order no longer mirrors the app's",
  );
});

test("the window-controls band is continuous with the dock surface", () => {
  // `checkControls` asserts the band and the adjacent `.work-panel-header`
  // paint the same background whenever the panel is open. That equality is not
  // a property of either rule on its own — `.window-controls` is
  // `--ds-bg-primary` and the header is `--ds-bg-dock-raised` — it holds only
  // because of the `:has(> .work-panel)` override. Deleting that one rule turns
  // every open-panel check into a failure, and nothing else in the suite can
  // see it: `tests/topbar-consistency.test.mjs` pins the band's own background
  // and `tests/surface-polish.test.mjs` pins the header's, neither the
  // override. So the static fact is pinned here, where it is cheap, instead of
  // resting on an e2e run that only happens on request.
  const chrome = readFileSync(join(rendererRoot, "styles", "chrome.css"), "utf8");
  const override = chrome.match(
    /\.app-shell:has\(>\s*\.work-panel\)\s*>\s*\.window-controls\s*\{([^}]*)\}/,
  );
  assert.ok(
    override,
    "styles/chrome.css no longer carries the `.app-shell:has(> .work-panel) > " +
      ".window-controls` override, so the band stops matching the dock header " +
      "background and every open-panel hit-test check fails",
  );
  assert.match(
    override[1],
    /background:\s*var\(--ds-bg-dock-raised\)/,
    "the band's open-panel override must paint `--ds-bg-dock-raised`, the same " +
      "token `.work-panel-header` uses; checkControls compares the two",
  );
});

test("the three controls keep the order the runner's positional clicks assume", () => {
  // The runner clicks `.window-control-btn:first-child` for minimize and
  // `:nth-child(2)` for maximize/restore. `baseToken()` deliberately reduces
  // both to the `window-control-btn` class, so it cannot see which *position*
  // was meant: inserting a fourth control, or reordering these three, leaves
  // every other assertion green while the runner clicks the wrong button and
  // times out waiting for the native window to maximize.
  const controls = readFileSync(
    join(rendererRoot, "components", "WindowControls.vue"),
    "utf8",
  );
  // Only the `@click` handlers, in document order: `api.windowControl("getState")`
  // lives in the script block and is not a button.
  const order = [...controls.matchAll(/@click="[^"]*windowControl\('(\w+)'\)/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    order,
    ["minimize", "toggleMaximize", "close"],
    "the renderer-drawn window controls must stay minimize, maximize/restore, " +
      "close, in that order: the runner addresses the first two by position",
  );

  // And the band must hold exactly three, which is what `checkControls`
  // asserts at runtime on Windows/Linux.
  const buttons = controls.match(/class="window-control-btn/g) ?? [];
  assert.equal(
    buttons.length,
    3,
    `WindowControls.vue renders ${buttons.length} .window-control-btn elements; ` +
      "checkControls expects exactly three on Windows/Linux",
  );
});
