/**
 * The `TooltipButton` attribute and element contract.
 *
 * `TooltipButton` is the renderer's most-used primitive (40 call sites), and it
 * serves two roles: `Tooltip` rendered a `<span>`, `TooltipButton` rendered a
 * `<button>`. Two defects came out of that union, and both were invisible to
 * every other gate:
 *
 *  1. The template has two root nodes (`<component>` plus a conditional
 *     `<Teleport>`), so Vue refuses automatic attribute inheritance and *warns
 *     then drops* every non-prop attribute. Only `$attrs.class` was forwarded,
 *     so `id`, `data-*` and `aria-*` never reached the DOM. Callers depend on
 *     those attributes:
 *     `.thread-item-more[aria-expanded="true"]` in `styles/sessions.css`, the
 *     `aria-labelledby` wiring on each sidebar project group, and the `data-nav`
 *     / `data-action` hooks the e2e runners query.
 *
 *  2. `as` defaulted to `"span"`. Ten call sites omit `as=` while passing
 *     `type="button"` and `:disabled`, and two of them live in `AppShell.vue`,
 *     which must not be edited. Those controls rendered as inert `<span>`s:
 *     `:disabled` was consumed by the declared prop and dropped, and
 *     `.shortcut-disable:disabled { opacity: .28 }` (`settings.css:712`) and
 *     `.app-work-panel-toggle:disabled` (`chrome.css:553`) never matched.
 *
 * `tests/vue-class-contract` reads class attributes, `renderer-module-graph`
 * resolves imports, and `vue-tsc` checks types — none of them renders a
 * component, so neither defect could fail a gate. These tests pin the two
 * invariants as source contracts, because that is the only level at which this
 * suite can see them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { rendererPath, rendererRoot, templateOf, walk } from "./helpers/class-contract.mjs";

const componentFile = `${rendererRoot}components/TooltipButton.vue`;
const componentSource = readFileSync(componentFile, "utf8");

const vueFiles = walk(rendererRoot, (name) => name.endsWith(".vue"));

/** A component's `<script setup>` block, which is where its options live. */
function scriptOf(source) {
  return source.match(/<script\b[^>]*>([\s\S]*)<\/script>/)?.[1] ?? "";
}

/**
 * Every `<TooltipButton>` opening tag in a template, with its full text.
 *
 * Quoted attribute values are respected, so a `>` inside a binding (`:label=
 * "a > b"`) does not end the tag early — the naive regex this replaced did, and
 * reported truncated tags whose `as`/`type` it then could not see.
 */
function openingTags(source, name) {
  const tags = [];
  const re = new RegExp(`<${name}\\b`, "g");
  let match;
  while ((match = re.exec(source))) {
    let index = match.index;
    let quote = null;
    while (index < source.length) {
      const character = source[index];
      if (quote !== null) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
      index += 1;
    }
    tags.push(source.slice(match.index, index + 1));
  }
  return tags;
}

/**
 * How many `<tag>` elements in `source` are still open at its end.
 *
 * A self-closing `<button />` is counted as closed, because that is what Vue's
 * SFC compiler does — verified against `@vue/compiler-sfc`, which emits the
 * element with no children and leaves the following sibling outside it. The
 * naive `<button` / `</button>` count this replaced treated every self-closing
 * tag as open, so `PluginDetailSheet.vue`'s scrim (`<button … />` before the
 * `<aside>` that holds the close button) was reported as a nesting violation
 * that does not exist in the rendered DOM.
 */
function unclosed(source, tag) {
  let open = 0;
  const re = new RegExp(`<${tag}\\b`, "g");
  let match;
  while ((match = re.exec(source))) {
    let index = match.index;
    let quote = null;
    while (index < source.length) {
      const character = source[index];
      if (quote !== null) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
      index += 1;
    }
    // `<button … />` closes itself; only an unclosed one counts as an ancestor.
    if (source[index - 1] !== "/") open += 1;
  }
  return open - (source.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
}

/**
 * Blank out comments so commented-out markup is not read as a call site.
 *
 * `ConversationTopbar.vue` documents this component in its header and quotes
 * `<TooltipButton>` there, which the scanner would otherwise count as a real
 * site with no attributes at all. Newlines are preserved so reported line
 * context stays truthful.
 */
function stripComments(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
}

/** Every call site of `<TooltipButton>` in the renderer tree. */
function tooltipButtonSites() {
  const sites = [];
  for (const file of vueFiles) {
    const path = rendererPath(rendererRoot, file);
    if (path === "components/TooltipButton.vue") continue;
    const source = stripComments(readFileSync(file, "utf8"));
    for (const tag of openingTags(source, "TooltipButton")) {
      sites.push({ path, tag });
    }
  }
  return sites;
}

test("the component tree still contains TooltipButton call sites", () => {
  // A walk that stops finding files would make every assertion below vacuous.
  const sites = tooltipButtonSites();
  assert.ok(
    sites.length > 20,
    `expected many <TooltipButton> call sites, found ${sites.length}`,
  );
});

test("TooltipButton forwards its non-prop attributes to the anchor", () => {
  // The two halves of the fix, both required: `inheritAttrs: false` stops Vue
  // from trying (and failing) to inherit, and the explicit bind is what
  // actually places the attributes. Either one alone leaves them dropped.
  const script = scriptOf(componentSource);
  assert.match(
    script,
    /inheritAttrs:\s*false/,
    "TooltipButton must set `inheritAttrs: false`: its two-root template makes " +
      "Vue warn and drop every non-prop attribute instead of inheriting them.",
  );

  const template = templateOf(componentSource);
  const anchor = openingTags(template, "component")[0] ?? "";
  assert.ok(anchor, "TooltipButton's anchor `<component>` element is missing");
  assert.match(
    anchor,
    /v-bind="\{\s*\.\.\.\$attrs/,
    "TooltipButton's anchor must spread `$attrs`, or `id`/`data-*`/`aria-*` " +
      "from every call site are silently dropped.",
  );
});

test("the anchor bind keeps the caller's values, not the defaults", () => {
  // `anchorAttrs` supplies `type`/`aria-label`/`disabled`. Those must be written
  // *after* the spread, so a caller's own value wins. Spreading `$attrs` first
  // reproduces that order.
  const template = templateOf(componentSource);
  const anchor = openingTags(template, "component")[0] ?? "";
  const spread = anchor.match(/v-bind="\{\s*\.\.\.\$attrs\s*,\s*\.\.\.anchorAttrs\s*\}"/);
  assert.ok(
    spread,
    "TooltipButton's anchor must bind `{ ...$attrs, ...anchorAttrs }`: " +
      "`$attrs` first so a caller's explicit attribute still wins.",
  );
});

test("TooltipButton defaults to a button anchor", () => {
  // The `TooltipButton` case dominates: the plain `<Tooltip>` (span) sites live
  // in `ModelSelectionPanes.vue` and pass `as="span"` explicitly. Two call
  // sites that rely on the default live in the frozen `AppShell.vue`, so the
  // default has to be the button they meant.
  const script = scriptOf(componentSource);
  assert.match(
    script,
    /as:\s*"button"/,
    'TooltipButton\'s `as` default must be "button": ten call sites omit `as=` ' +
      'while passing `type="button"`/`:disabled`, and a span anchor would drop ' +
      "`disabled` (a declared prop, so it is absent from `$attrs`) and stay " +
      "clickable.",
  );
});

test("the span-anchor call sites are exactly the two plain Tooltip sites", () => {
  // This started as "no call site asks for a span anchor", because at the time
  // the span case was unused. `ModelSelectionPanes.vue` now passes `as="span"`,
  // so the empty list is no longer the truth and the guard is the exact set
  // instead.
  //
  // The set has two entries from the same file because that file renders two
  // plain `<Tooltip>` spans: the `availableForSubagents` help icon and the
  // `nativeWebSearch` one. Pinning the multiset keeps the assertion's value: a
  // *new* span site means the `as` default of "button" is worth revisiting,
  // which is what this test exists to surface. It also catches a span site
  // being dropped (the component would then render a `<button>`, which is a
  // real DOM divergence — a button is focusable and a span is not).
  const spans = tooltipButtonSites()
    .filter((site) => /(?:^|\s):?as\s*=\s*"span"/.test(site.tag))
    .map((site) => site.path);
  assert.deepEqual(
    spans,
    [
      "components/settings/ModelSelectionPanes.vue",
      "components/settings/ModelSelectionPanes.vue",
    ],
    "the set of span-anchor call sites changed. If a call site was added, " +
      "re-check whether the `as` default of \"button\" still matches the " +
      "majority of call sites; if one was removed, a plain `<Tooltip>` site " +
      "was dropped and the component now renders a `<button>` where it " +
      "rendered a `<span>`.",
  );
});

test("no TooltipButton call site nests inside another interactive element", () => {
  // This is the reason the `as` default cannot simply be "button" forever
  // without thought: a `<button>` inside an `<a>` or another `<button>` is
  // invalid HTML and browsers will hoist it out, which changes the layout.
  // Every site uses a `<button>`, so no site should be nested; if a
  // future surface needs a tooltip inside a link, it must pass `as="span"`.
  const nested = [];
  for (const file of vueFiles) {
    const path = rendererPath(rendererRoot, file);
    if (path === "components/TooltipButton.vue") continue;
    const source = stripComments(readFileSync(file, "utf8"));
    for (const tag of openingTags(source, "TooltipButton")) {
      // A site that asks for a span is allowed to be nested.
      if (/(?:^|\s):?as\s*=\s*"span"/.test(tag)) continue;
      const before = source.slice(0, source.indexOf(tag));
      const open = unclosed(before, "button");
      const openLinks = unclosed(before, "a");
      if (open > 0) {
        nested.push(`${path}: <TooltipButton> inside an open <button>`);
      } else if (openLinks > 0) {
        nested.push(`${path}: <TooltipButton> inside an open <a>`);
      }
    }
  }
  assert.deepEqual(
    nested,
    [],
    `a button anchor would be nested inside another interactive element, which ` +
      `is invalid HTML: ${nested.join(" | ")}. Pass as="span" at that site.`,
  );
});
