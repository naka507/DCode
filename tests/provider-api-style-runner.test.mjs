/**
 * `scripts/e2e-provider-api-style.mjs` — the custom-provider API-format
 * boundary runner, and its fixture `scripts/e2e/provider-api-style.ts`.
 *
 * A runner is the one artifact in this repository that no other gate can check.
 * `npm test` never executes it (it starts Electron), `vue-tsc` does not read it,
 * and the class contract only reads `.vue` templates. So a runner that queries a
 * selector the renderer stopped rendering, or that drives the wrong DOM event,
 * fails only when someone runs it against a real app — which per `AGENTS.md`
 * § 12 happens only on explicit request.
 *
 * This file pins the four contracts a copy-and-edit can silently break and
 * nothing else in the tree can see:
 *
 *  1. **The DOM contract.** The fixture reaches for
 *     `.settings-menu-select-trigger`, `.settings-menu-select-option`,
 *     `.settings-menu-select-option-label`, `.provider-service-trigger`,
 *     `.provider-service-option` and `.ui-help-icon`, and reads the portaled
 *     dialog through `#dcode-overlays`. Those names live in `.vue` files
 *     and one `.ts` module, so the assertions below read the real sources and
 *     fail if a rename happens without the fixture. The stale selector this
 *     port replaced (`.provider-setup-custom-auth-row select`) is asserted
 *     *absent*: the guard only means something while it is gone.
 *  2. **The label map.** `ProviderSetupDialog.vue` does not export
 *     `API_STYLE_LABEL_KEYS`, so the fixture carries a copy. The option ids are
 *     not in the DOM, so that copy is the only way to tell which option is
 *     which; the assertions parse both literals and compare them.
 *  3. **The bundler swap.** `esbuild` cannot compile an SFC, so the
 *     fixture goes through vite + `@vitejs/plugin-vue`; the runner needs no
 *     host and no preload, so it must not import the shared host driver.
 *  4. **The runner shape.** The marker, the 45s timeout, the sandboxed hidden
 *     window, the throwaway temp directory and its cleanup are unchanged, and
 *     the npm alias and README row exist.
 *
 * Everything else — that the dialog actually renders those options, that a
 * saved account-only format stays visible but unchoosable, that a copy keeps
 * its own identity — is only provable by running the runner, so it is not
 * asserted here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { CUSTOM_PROVIDER_API_STYLES } = await import(
  "../src/renderer/components/settings/provider-api-style.ts"
);

const root = fileURLToPath(new URL("../", import.meta.url));
const runnerPath = join(root, "scripts", "e2e-provider-api-style.mjs");
const fixturePath = join(root, "scripts", "e2e", "provider-api-style.ts");
const dialogPath = join(
  root,
  "src",
  "renderer",
  "components",
  "settings",
  "ProviderSetupDialog.vue",
);
const menuSelectPath = join(
  root,
  "src",
  "renderer",
  "components",
  "settings",
  "SettingsMenuSelect.vue",
);
const servicePickerPath = join(
  root,
  "src",
  "renderer",
  "components",
  "settings",
  "ServicePicker.vue",
);
const helpIconPath = join(
  root,
  "src",
  "renderer",
  "components",
  "ui",
  "HelpIcon.vue",
);
const overlayRootPath = join(root, "src", "renderer", "lib", "overlay-root.ts");
const packagePath = join(root, "package.json");
const readmePath = join(root, "scripts", "README.md");

const runner = readFileSync(runnerPath, "utf8");
const fixture = readFileSync(fixturePath, "utf8");
const dialog = readFileSync(dialogPath, "utf8");
const menuSelect = readFileSync(menuSelectPath, "utf8");
const servicePicker = readFileSync(servicePickerPath, "utf8");
const helpIcon = readFileSync(helpIconPath, "utf8");
const overlayRoot = readFileSync(overlayRootPath, "utf8");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const readme = readFileSync(readmePath, "utf8");

/** `key: "value"` pairs of the object literal that starts at `marker`. */
function labelPairs(source, marker, name) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${name}: ${marker} is gone`);
  const end = source.indexOf("};", start);
  assert.ok(end > start, `${name}: ${marker} is not a closed literal`);
  const body = source.slice(start + marker.length, end);
  const pairs = [
    ...body.matchAll(/([A-Za-z_][A-Za-z0-9_]*):\s*"([^"]+)"/g),
  ].map((match) => `${match[1]}=${match[2]}`);
  assert.ok(
    pairs.length > 0,
    `${name}: ${marker} parsed to nothing, so the comparison below is vacuous`,
  );
  return pairs;
}

test("the runner is registered as an npm alias and documented", () => {
  assert.equal(
    packageJson.scripts["test:e2e:provider-api-style"],
    "node scripts/e2e-provider-api-style.mjs",
  );
  assert.match(
    readme,
    /^\| `e2e-provider-api-style\.mjs` \| `npm run test:e2e:provider-api-style` \|/m,
  );
});

test("the runner builds the Vue fixture with vite, not esbuild", () => {
  // `esbuild` cannot compile an SFC, so the fixture goes through vite + the
  // Vue plugin. This runner has no main-process half to keep on esbuild.
  assert.match(runner, /require\.resolve\("vite"\)/);
  assert.match(runner, /require\.resolve\("@vitejs\/plugin-vue"\)/);
  assert.match(runner, /plugins: \[vue\(\)\]/);
  assert.match(runner, /entry: join\(root, "scripts\/e2e\/provider-api-style\.ts"\)/);
  assert.match(runner, /formats: \["iife"\]/);
  // One Vue instance for the fixture and the components it renders.
  assert.match(runner, /vue: join\(root, "node_modules\/vue"\)/);
  assert.ok(
    !/require\.resolve\("esbuild"\)/.test(runner),
    "the runner must not bundle with esbuild",
  );
});

test("the runner needs no host and no preload", () => {
  assert.match(runner, /import \{ resolveElectronBinary \} from "\.\/e2e\/boot\.mjs"/);
  assert.ok(
    !/from "\.\/e2e\/host\.mjs"/.test(runner),
    "the API boundary is stubbed in the fixture, so the runner must not need the host driver",
  );
  // The window is created without a preload, so `window.dcode` is absent and
  // the stubbed `api` surface is the only boundary the probe can reach.
  assert.ok(
    !/webPreferences: \{[^}]*preload/.test(runner),
    "the fixture never touches the preload bridge, so the window must not load one",
  );
});

test("the runner keeps the marker, timeout, window and cleanup", () => {
  assert.match(runner, /mkdtemp\(join\(tmpdir\(\), "pi-provider-api-style-"\)\)/);
  assert.match(runner, /line\.startsWith\("PROVIDER_API_STYLE_PROBE "\)/);
  assert.match(
    runner,
    /console\.log\("PROVIDER_API_STYLE_PROBE " \+ JSON\.stringify\(result\)\)/,
  );
  assert.match(runner, /line\.slice\("PROVIDER_API_STYLE_PROBE "\.length\)/);
  assert.match(runner, /setTimeout\(\(\) => child\.kill\("SIGKILL"\), 45_000\)/);
  assert.match(runner, /delete env\.ELECTRON_RUN_AS_NODE/);
  assert.match(runner, /await rm\(temp, \{ recursive: true, force: true \}\)/);
  // The same CSP meta, the same hidden sandboxed window, the same console
  // forwarding: every message the probe logs has to reach the runner's output.
  // The quotes inside the HTML string literal are backslash-escaped in the
  // source, so they are unescaped before the comparison.
  const runnerHtml = runner.replace(/\\'/g, "'");
  assert.ok(
    runnerHtml.includes(
      "content=\"default-src 'self'; style-src 'self' 'unsafe-inline'\"",
    ),
    "the runner no longer writes the expected CSP meta",
  );
  assert.match(
    runner,
    /new BrowserWindow\(\{ show: false, webPreferences: \{ sandbox: true, contextIsolation: true, nodeIntegration: false \} \}\)/,
  );
  assert.match(
    runner,
    /window\.webContents\.on\("console-message", \(event\) => console\.error\(event\.message\)\)/,
  );
  assert.match(runner, /app\.setPath\("userData", path\.join\(__dirname, "profile"\)\)/);
  assert.match(
    runner,
    /renderer returned no probe result \(exit=\$\{code\}\): \$\{output\.slice\(-2000\)\}/,
  );
});

test("the fixture's API-style label map is identical to the dialog's", () => {
  // `API_STYLE_LABEL_KEYS` is not exported, and an option's id never reaches the
  // DOM, so this copy is what makes the fixture able to tell the options apart.
  const dialogPairs = labelPairs(
    dialog,
    "const API_STYLE_LABEL_KEYS: Record<CatalogApiStyle, string> = {",
    "ProviderSetupDialog.vue",
  );
  const fixturePairs = labelPairs(
    fixture,
    "const API_STYLE_LABEL_KEYS: Record<string, string> = {",
    "provider-api-style.ts",
  );
  assert.deepEqual(
    fixturePairs,
    dialogPairs,
    "the fixture's label map drifted from ProviderSetupDialog.vue",
  );
  // Every general format the fixture asserts on has to be in that map, or the
  // option-set comparison would silently compare against `undefined`.
  for (const style of CUSTOM_PROVIDER_API_STYLES) {
    assert.ok(
      fixturePairs.some((pair) => pair.startsWith(`${style}=`)),
      `the fixture's label map has no entry for ${style}`,
    );
  }
});

test("the fixture asserts the option set against CUSTOM_PROVIDER_API_STYLES", () => {
  assert.deepEqual(CUSTOM_PROVIDER_API_STYLES, [
    "chat_completions",
    "responses",
    "anthropic_messages",
    "google_generative_ai",
  ]);
  assert.match(fixture, /CUSTOM_PROVIDER_API_STYLES\.map\(/);
  assert.match(fixture, /`\$\{locale\}: new custom form exposes an account format`/);
  // The account-only formats the set must exclude are the ones the probe edits.
  for (const style of ["openai_codex_responses", "pi_messages"]) {
    assert.ok(
      fixture.includes(`"${style}"`),
      `the fixture no longer exercises ${style}`,
    );
    assert.ok(
      !CUSTOM_PROVIDER_API_STYLES.includes(style),
      `${style} must not be offered as a new custom format`,
    );
  }
});

test("the fixture's selectors still exist in the renderer", () => {
  // Every selector the fixture queries, and the source that renders it.
  const selectors = [
    [".settings-menu-select-trigger", menuSelect],
    [".settings-menu-select-trigger-label", menuSelect],
    [".settings-menu-select-option", menuSelect],
    [".settings-menu-select-option-label", menuSelect],
    [".provider-service-trigger", servicePicker],
    [".provider-service-option", servicePicker],
    [".ui-help-icon", helpIcon],
    ["dcode-overlays", overlayRoot],
    [".provider-setup-dialog", dialog],
    [".provider-setup-custom-auth-row", dialog],
  ];
  for (const [selector, source] of selectors) {
    const name = selector.replace(/^\./, "");
    assert.ok(
      source.includes(name),
      `${name} is queried by the fixture but no longer rendered`,
    );
    assert.ok(
      fixture.includes(selector),
      `the fixture no longer queries ${selector}`,
    );
  }
  // The dialog is a portal, so the fixture must not read it through `host`.
  assert.match(fixture, /document\.querySelector<HTMLElement>\(\s*"\.provider-setup-dialog"/);
  // The menu is teleported to `document.body` by `AnchoredMenu`, so the options
  // are outside the dialog too.
  assert.match(fixture, /document\.querySelectorAll<HTMLButtonElement>\(\s*"\.settings-menu-select-option"/);
});

test("the stale native-select selector does not come back", () => {
  // Positive control: the replacement selector is present, so the absences
  // below are not passing on an empty string.
  assert.ok(fixture.includes(".settings-menu-select-trigger"));
  assert.ok(fixture.includes(".settings-menu-select-option"));
  assert.ok(
    !fixture.includes(".provider-setup-custom-auth-row select"),
    "the fixture still queries the native select that SettingsMenuSelect replaced",
  );
  for (const stale of [
    "HTMLSelectElement",
    "selectedOptions",
    "querySelector(\"select\")",
    "new Event(\"change\"",
  ]) {
    assert.ok(
      !fixture.includes(stale),
      `the fixture still reads the native select through ${stale}`,
    );
  }
  // And the component really has no `<select>` left for it to find.
  assert.ok(
    !/<select[\s>]/.test(dialog),
    "ProviderSetupDialog.vue renders a native select again, so the fixture's replacement is wrong",
  );
});

test("the fixture reads the hint from the help icon's accessible name", () => {
  // `Field` renders the hint as `<HelpIcon :label="hint" />`, whose sentence
  // lives in a tooltip that is only mounted while hovered, so it is not in
  // `textContent`. `HelpIcon` puts the same sentence on the trigger's name.
  assert.match(helpIcon, /:aria-label="label"/);
  assert.match(dialog, /<HelpIcon/);
  assert.match(fixture, /\.ui-help-icon/);
  assert.match(fixture, /apiStyleHint\(\) === t\("settings\.apiStyleLegacyAccount"\)/);
  assert.match(fixture, /apiStyleHint\(\) === t\("settings\.apiStyleChooseCustom"\)/);
  assert.match(fixture, /"legacy explanation missing"/);
  assert.match(fixture, /"copy choice explanation missing"/);
});

test("the fixture is the probe with the Vue bridges, and nothing else", () => {
  // The entry point the runner calls.
  assert.match(fixture, /globalThis\.providerApiStyleProbe = async \(\) => \{/);
  // The Vue bridges, each one named in the fixture's own header.
  assert.match(fixture, /app\.config\.errorHandler = \(error\) => \{/);
  assert.match(fixture, /console\.error\("PROVIDER_API_STYLE_RENDER_ERROR", error\)/);
  assert.match(fixture, /assert\(errors\.length === 0, "render errors"\)/);
  assert.match(fixture, /app\.use\(i18n\)/);
  assert.match(fixture, /i18n\.global\.locale\.value = locale/);
  assert.match(fixture, /i18n\.global\.t\(key\)/);
  assert.match(fixture, /await nextTick\(\)/);
  // The dialog's emits arrive as `h` props; the probe still counts closes.
  assert.match(fixture, /onClose: \(\) => \{/);
  assert.match(fixture, /closes \+= 1/);
  assert.match(fixture, /onSaved: \(\) => \{\}/);
  // The API boundary is monkey-patched, as the probe requires.
  assert.match(fixture, /api\.createProvider = async \(input\) => \{/);
  assert.match(fixture, /api\.updateProvider = async \(input\) => \{/);
  assert.match(fixture, /api\.listProviderModels = async \(input\) => \{/);
  assert.match(fixture, /structuredClone\(/);
  // The Pinia store is deliberately not installed: nothing in the dialog's
  // dependency graph reads it.
  assert.ok(
    !fixture.includes("rendererPinia"),
    "the dialog has no store dependency, so the fixture must not install Pinia",
  );
  // The scenario order, the result keys and every surviving probe message.
  for (const literal of [
    'for (const locale of ["en", "zh-CN"])',
    'for (const style of ["openai_codex_responses", "pi_messages"])',
    "${locale}:new-custom-options",
    "${locale}:${style}:edit-change-copy-cancel",
    "legacy format must remain visible without being a new choice",
    "legacy edit changed protocol/name/URL through preset matching",
    "legacy edit changed authentication",
    "legacy bindings changed",
    "explicit legacy protocol change not saved",
    "copy silently converted protocol",
    "copy accepts account-only protocol",
    "unsupported copy triggered discovery",
    "blocked copy was saved",
    "cancel saved a copy",
    "copy discovery reused source protocol or credentials",
    "supported copy is blocked",
    "copy did not persist the explicitly chosen protocol",
    "copy retained source identity or credential",
    "edit/copy mutated source object",
    'apiBoundary: "stubbed"',
    'hostPersistence: "not exercised"',
    'liveModel: "not exercised"',
  ]) {
    assert.ok(
      fixture.includes(literal),
      `the fixture no longer asserts "${literal}"`,
    );
  }
  // The fixture's own copy of the fixture provider: the single model with its
  // alias, and the stored secret the copy must not carry over.
  assert.match(fixture, /alias: "Fixture alias"/);
  assert.match(fixture, /hasSecret: true/);
  // The discovery debounce the probe has to outwait.
  assert.match(fixture, /await pause\(650\)/);
});
