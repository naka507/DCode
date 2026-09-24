import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  CLASS_ALLOWLIST,
  addDynamicClasses,
  definedClasses,
  rendererPath,
  rendererRoot,
  templateOf,
  usedClasses,
  walk,
} from "./helpers/class-contract.mjs";
import { loadStylesSync } from "./helpers/styles.mjs";

/**
 * Component class-name contract.
 *
 * The renderer's visual system is the shared stylesheet under
 * `src/renderer/styles/` — partials of semantic class names sequenced by
 * `globals.css`, with Tailwind contributing only the `@theme` token scales.
 * Components carry the class names the stylesheet defines, so the CSS keeps
 * styling them.
 *
 * The failure this guards against is drift: a `.vue` file that invents its own
 * class names (and usually a private `<style>` block with it) renders an
 * unstyled surface while the stylesheet it was supposed to use sits unused.
 * `PluginLauncher.vue` did exactly that — `.dc-launcher*`
 * matched no rule anywhere.
 *
 * The parsers live in `helpers/class-contract.mjs` and are unit-tested below,
 * because a guard that silently stops matching passes forever.
 */

const stylesheetClasses = definedClasses(loadStylesSync());
const vueFiles = walk(rendererRoot, (name) => name.endsWith(".vue"));

test("the stylesheet contract surface is not empty", () => {
  // If globals.css ever stops inlining its partials, or the prelude scan breaks,
  // fail loudly here instead of reporting a clean sweep.
  assert.ok(
    stylesheetClasses.size > 500,
    `expected the shared stylesheet to define many classes, found ${stylesheetClasses.size}`,
  );
  assert.ok(vueFiles.length > 0, "expected at least one .vue component to check");
});

for (const file of vueFiles) {
  const relativePath = rendererPath(rendererRoot, file);
  const allowed = new Set(CLASS_ALLOWLIST[relativePath]?.classes ?? []);

  test(`${relativePath} only uses class names the shared stylesheet defines`, () => {
    const undefinedClasses = [...usedClasses(templateOf(readFileSync(file, "utf8")))]
      .filter((name) => !stylesheetClasses.has(name) && !allowed.has(name))
      .sort();

    assert.deepEqual(
      undefinedClasses,
      [],
      undefinedClasses.length === 0
        ? undefined
        : `${relativePath} renders class names no stylesheet rule targets: ` +
          `${undefinedClasses.join(", ")}. ` +
          "Reuse the class names from the matching partial in src/renderer/styles/, " +
          "or add the names to CLASS_ALLOWLIST in tests/helpers/class-contract.mjs with a reason.",
    );
  });
}

test("allowlisted class names are still undefined, not stale exemptions", () => {
  // If a partial later grows a rule for an allowlisted name, the exemption is
  // dead and should be deleted; otherwise the list slowly stops meaning anything.
  const stale = [];
  for (const [relativePath, entry] of Object.entries(CLASS_ALLOWLIST)) {
    for (const name of entry.classes) {
      if (stylesheetClasses.has(name)) stale.push(`${relativePath}: ${name}`);
    }
  }
  assert.deepEqual(stale, [], `allowlisted classes are now defined in CSS: ${stale.join(", ")}`);
});

test("allowlisted entries are exhaustive for their file", () => {
  // An allowlisted file must still pass the contract apart from its listed
  // names, so the list cannot hide new drift.
  const regressions = [];
  for (const [relativePath, entry] of Object.entries(CLASS_ALLOWLIST)) {
    const file = join(rendererRoot, relativePath);
    if (!vueFiles.includes(file)) {
      regressions.push(`${relativePath}: file no longer exists, remove the entry`);
      continue;
    }
    const allowed = new Set(entry.classes);
    const unexpected = [...usedClasses(templateOf(readFileSync(file, "utf8")))]
      .filter((name) => !stylesheetClasses.has(name) && !allowed.has(name))
      .sort();
    if (unexpected.length) regressions.push(`${relativePath}: ${unexpected.join(", ")}`);
  }
  assert.deepEqual(
    regressions,
    [],
    `allowlisted files grew unlisted undefined classes: ${regressions.join(" | ")}`,
  );
});

test("the class contract covers the whole renderer tree", () => {
  // Guards against a walk that stops finding components after a directory move.
  const found = vueFiles.map((file) => rendererPath(rendererRoot, file)).sort();
  for (const name of [
    "App.vue",
    "components/PluginLauncher.vue",
    "components/ProjectCreateDialog.vue",
  ]) {
    assert.ok(found.includes(name), `${name} is no longer discovered by the class contract walk`);
  }
});

/**
 * Parser fixtures.
 *
 * These exist because the contract's value depends entirely on the parsers
 * being able to fail: a regex that quietly stops matching would let any amount
 * of class drift through while the suite stayed green.
 */

test("definedClasses reads rule preludes and ignores non-class text", () => {
  const defined = definedClasses(`
    /* .commented-out {} */
    @import "./other.css";
    [data-surface="plugin-launcher"] { background: transparent; }
    .plain { color: red; }
    .a, .b { color: red; }
    @media (min-width: 600px) { .nested { color: red; } }
    .with-pseudo::placeholder { color: red; }
    .mod:hover, .mod.active { color: red; }
    @theme { --color-x: var(--ds-x); }
    .url { background: url("./dot.png"); }
  `);
  for (const name of ["plain", "a", "b", "nested", "with-pseudo", "mod", "url"]) {
    assert.ok(defined.has(name), `expected .${name} to be read as a defined class`);
  }
  for (const name of ["commented-out", "other", "dot", "surface", "data"]) {
    assert.ok(!defined.has(name), `.${name} must not count as a defined class`);
  }
});

test("definedClasses does not treat a declaration value as a rule prelude", () => {
  // `content: "{"` would otherwise open a phantom block and swallow the next
  // real selector, hiding a genuinely undefined class.
  const defined = definedClasses(`
    .before::after { content: "{"; }
    .after { color: red; }
  `);
  assert.ok(defined.has("before"), "the rule before the brace literal is still read");
  assert.ok(defined.has("after"), "the rule after the brace literal is still read");
});

test("usedClasses reads every class-bearing template form", () => {
  const used = usedClasses(`
    <div class="static one" :class="{ active: isActive, 'is-quoted': flag }"></div>
    <span class='single-quoted'></span>
    <b :class="cond ? 'ternary-a' : 'ternary-b'"></b>
    <i :class="['array-a', flag && 'array-b']"></i>
    <u v-bind:class="{ 'bind-key': flag }"></u>
    <em :class="\`prefix-\${flag ? 'tpl-cond' : ''}\`"></em>
  `);
  for (const name of [
    "static",
    "one",
    "active",
    "is-quoted",
    "single-quoted",
    "ternary-a",
    "ternary-b",
    "array-a",
    "array-b",
    "bind-key",
    "tpl-cond",
  ]) {
    assert.ok(used.has(name), `expected ${name} to be read as a used class`);
  }
  // Identifiers and operators inside a binding are not class names.
  for (const name of ["isActive", "flag", "cond"]) {
    assert.ok(!used.has(name), `${name} is an expression identifier, not a class name`);
  }
  // Static text in a template literal is kept verbatim, so a fragment glued to
  // an interpolation (`prefix-` in `` `prefix-${x}` ``) is reported even though
  // it is not a class name. That over-report is deliberate — see
  // `addTemplateLiteralClasses` — and the contract failure it produces points at
  // the fix (a static `class` plus an object `:class` binding).
  assert.ok(used.has("prefix-"), "static template text is reported verbatim");
});

test("addDynamicClasses keeps object keys and drops their values", () => {
  const out = new Set();
  addDynamicClasses(out, "{ 'is-active': source === 'local' }");
  assert.deepEqual([...out], ["is-active"]);
});

test("usedClasses ignores a class attribute that is not one", () => {
  // `class` as a substring of another attribute must not be read as a binding.
  const used = usedClasses(`<div data-class="not-a-class" :data-class="x"></div>`);
  assert.deepEqual([...used], [], `unexpected classes: ${[...used].join(", ")}`);
});
