import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createI18n } from "vue-i18n";
import { catalogs, flattenCatalog, supportedLocales } from "../src/i18n/index.ts";
import {
  i18n,
  pluralRules,
  rendererMessages,
  toVueI18nMessage,
  toVueI18nMessages,
} from "../src/renderer/i18n.ts";

/**
 * Renderer i18n dialect contract.
 *
 * The catalogs under `src/i18n/locales/` are written in the *i18next* dialect:
 * `{{name}}` placeholders, `_one` / `_other` plural keys, and literal `@`, `|`
 * and braces in ordinary prose. The Vue
 * plural keys, and literal `@`, `|` and braces in ordinary prose. The Vue
 * renderer runs vue-i18n, which gives every one of those a different meaning —
 * a bare `{{name}}` is a "Not allowed nest placeholder" *compile error*, `@`
 * starts a linked message, `|` splits plural forms, and `summary ≈{tokens}}` is
 * an unbalanced brace.
 *
 * Nothing checked this before, and the failure mode was invisible in the suite:
 * the messages are compiled lazily by `t()`, so the shell booted and only threw
 * the first time a translated string with a placeholder was rendered.
 *
 * The expected values below were taken from the real i18next runtime
 * (`i18next@26.3.6`, the version the catalogs target), not from reading the
 * catalogs, so they pin the semantics rather than restating the
 * implementation.
 */

/** A converted catalog, installed by importing the module. */
const messages = rendererMessages();

/** Params covering every placeholder that ships in the catalogs. */
const ALL_PARAMS = {
  count: 3,
  name: "n",
  version: "1",
  sessionTitle: "s",
  toolName: "t",
  tool: "t",
  path: "p",
  message: "m",
  args: "a",
  operation: "o",
  limit: 1,
  max: 2,
  width: 3,
  percent: 4,
  title: "T",
  tokens: 5,
  total: 9,
  range: "r",
  size: "s",
  number: 1,
  question: "q",
  agent: "a",
  workspace: "w",
};

/** Translate in one locale; return the thrown message so failures are readable. */
function translate(locale, key, params) {
  i18n.global.locale.value = locale;
  try {
    return i18n.global.t(key, params);
  } catch (error) {
    return `THREW: ${String(error.message).split("\n")[0]}`;
  }
}

test("the catalogs break a bare vue-i18n instance, so the conversion is load-bearing", () => {
  // The whole point of ./i18n.ts. If this ever stops failing, the dialect has
  // been normalised somewhere else and the conversion has become dead weight.
  const raw = createI18n({
    legacy: false,
    locale: "en",
    fallbackLocale: "en",
    missingWarn: false,
    fallbackWarn: false,
  });
  for (const [locale, catalog] of Object.entries(catalogs)) {
    raw.global.setLocaleMessage(locale, flattenCatalog(catalog));
  }

  let threw = 0;
  for (const [locale, catalog] of Object.entries(catalogs)) {
    raw.global.locale.value = locale;
    for (const key of Object.keys(flattenCatalog(catalog))) {
      try {
        raw.global.t(key, ALL_PARAMS);
      } catch {
        threw++;
      }
    }
  }
  assert.ok(threw > 400, `expected the raw catalogs to break, only ${threw} threw`);
});

test("every shipped message compiles under vue-i18n", () => {
  // The regression this exists for: one unconverted dialect construct makes the
  // whole message throw on first use, and only for the locale that uses it.
  const failures = [];
  let compiled = 0;
  for (const [locale, catalog] of Object.entries(messages)) {
    i18n.global.locale.value = locale;
    for (const key of Object.keys(catalog)) {
      compiled++;
      try {
        i18n.global.t(key, ALL_PARAMS);
      } catch (error) {
        if (failures.length < 10) {
          failures.push(`${locale} ${key}: ${String(error.message).split("\n")[0]}`);
        }
      }
    }
  }
  const total = Object.values(messages).reduce((n, catalog) => n + Object.keys(catalog).length, 0);
  assert.equal(compiled, total, `expected the whole catalog to be covered, saw ${compiled} of ${total}`);
  assert.deepEqual(failures, [], `messages failed to compile: ${failures.join(" | ")}`);
});

test("no message silently falls back to rendering its own key", () => {
  // A message that was never installed renders as its key. That is the quiet
  // failure mode: the UI looks translated but every string is a dotted path.
  const echoed = [];
  for (const [locale, catalog] of Object.entries(messages)) {
    i18n.global.locale.value = locale;
    for (const key of Object.keys(catalog)) {
      if (i18n.global.t(key, ALL_PARAMS) === key && echoed.length < 10) echoed.push(`${locale} ${key}`);
    }
  }
  assert.deepEqual(echoed, [], `keys rendered as their own name: ${echoed.join(" | ")}`);
});

test("importing ./i18n is enough to get a working instance", () => {
  // `main.ts` relies on this: it only picks the locale, it does not install
  // catalogs. Importing the module has to leave the instance usable.
  const installed = i18n.global.messages.value ?? i18n.global.messages;
  assert.deepEqual(
    Object.keys(installed).sort(),
    supportedLocales.map(({ id }) => id).sort(),
  );
});

test("the instance carries a plural rule for every shipped locale", () => {
  // Without these, vue-i18n falls back to its own singular/plural split, which
  // disagrees with i18next for Chinese, which has no `one` category.
  assert.deepEqual(
    Object.keys(i18n.global.pluralRules).sort(),
    supportedLocales.map(({ id }) => id).sort(),
  );
});

test("placeholders convert to the vue-i18n form and stay interpolatable", () => {
  assert.equal(toVueI18nMessage("Version {{version}} is available."), "Version {version} is available.");
  assert.equal(translate("en", "nav.branchTitle", { title: "Fix bug" }), "Fix bug (branch)");
  assert.equal(
    translate("en", "notifications.permissionBody", { toolName: "Bash" }),
    "Permission required to run Bash.",
  );
});

test("literal prose characters survive instead of being read as syntax", () => {
  // `@` would be a linked message, `|` a plural separator, and `≈{tokens}}` an
  // unbalanced brace — all three ship in real strings.
  assert.equal(translate("en", "chat.placeholderHint"), "Type / for commands · @ for files");
  assert.equal(translate("en", "chat.compactionRowSummary", { tokens: 5 }), "summary ≈5 tokens");
  assert.equal(
    translate("en", "extensions.subagents.maxTokensHint", { max: 4096 }),
    "Caps one response from the delegate. 1–4096, or leave empty to follow the model.",
  );
  assert.equal(translate("en", "chat.largeTextPasted", { name: "a.txt" }), "Saved large pasted text as @a.txt");
});

test("single-brace prose stays literal and is never interpolated", () => {
  // The consent strings live in the same catalogs but are consumed by the *main*
  // process, which does its own `.replace("{name}", …)`. vue-i18n would read
  // `{name}` as an interpolation, so the braces have to be escaped on the way in
  // — otherwise the renderer would substitute them and the main process would
  // print a literal `{name}`.
  assert.equal(
    translate("en", "pluginDesktopConsent.message", { name: "X", operation: "Y" }),
    "{name} wants to run {operation}",
  );
  assert.equal(
    translate("en", "pluginFsConsent.read", { name: "P" }),
    "{name} wants to read a file outside what it declared",
  );
  assert.equal(toVueI18nMessage("{name} wants to run {operation}"), "{'{'}name{'}'} wants to run {'{'}operation{'}'}");
});

test("the dialect conversion is a single pass, not a replace chain", () => {
  // A chain re-escapes the braces it just inserted, so a placeholder-bearing
  // message stops compiling. Assert the behaviour, not just that the two strings
  // differ — a `notEqual` against a hand-built wrong string also passes for an
  // implementation that does nothing at all.
  const chained = "{{count}} steps"
    .replace(/\{/g, "{'{'}")
    .replace(/\}/g, "{'}'}");
  const broken = createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false });
  broken.global.setLocaleMessage("en", { m: chained });
  assert.throws(() => broken.global.t("m", { count: 3 }), /Not allowed nest placeholder/);

  // The shipped conversion keeps the placeholder interpolatable.
  assert.equal(toVueI18nMessage("{{count}} steps"), "{count} steps");
  assert.equal(toVueI18nMessage("{{name}} wants to run {{operation}}"), "{name} wants to run {operation}");
  assert.equal(toVueI18nMessage("a | b"), "a {'|'} b");
  assert.equal(toVueI18nMessage("summary ≈{{tokens}} tokens"), "summary ≈{tokens} tokens");
});

test("English plural forms follow the CLDR one/other split", () => {
  // English selects `one` only for count 1; 0 and 5 both land on `other`.
  assert.equal(translate("en", "chat.resultSteps", { count: 1 }), "1 step");
  assert.equal(translate("en", "chat.resultSteps", { count: 0 }), "0 steps");
  assert.equal(translate("en", "chat.resultSteps", { count: 5 }), "5 steps");
});

test("a locale with no `one` category uses the `other` form at count 1", () => {
  // Chinese has only `other`; i18next reads "1 个来源", never a singular form.
  // Emitting a `one` slot here would silently invent a form the catalog never
  // wrote.
  assert.equal(translate("zh-CN", "chat.webSearchSources", { count: 1 }), "1 个来源");
  assert.equal(translate("zh-CN", "chat.resultSteps", { count: 1 }), "1 个步骤");
});

test("a bare key beside `_other` keeps its singular slot", () => {
  // `chat.processingSteps` ships as the bare key plus `_other`, with no `_one`.
  // i18next falls back to the bare key for the singular; dropping it turned
  // "1 step" into "1 steps".
  assert.equal(translate("en", "chat.processingSteps", { count: 1 }), "1 step");
  assert.equal(translate("en", "chat.processingSteps", { count: 5 }), "5 steps");
});

test("messages without placeholders render verbatim", () => {
  // i18next treats everything but `{{...}}` as literal text, so any divergence
  // here is escaping damage. Placeholder-bearing strings are covered above.
  // Derived from the catalogs instead of pinned to a literal: a catalog that
  // shrinks must not be able to turn full coverage into a silent skip.
  const expected = Object.values(catalogs)
    .flatMap((catalog) => Object.entries(flattenCatalog(catalog)))
    .filter(([key, raw]) => !raw.includes("{{") && !/_(zero|one|two|few|many|other)$/.test(key))
    .length;
  const divergences = [];
  let checked = 0;
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const flat = flattenCatalog(catalog);
    i18n.global.locale.value = locale;
    for (const [key, raw] of Object.entries(flat)) {
      if (raw.includes("{{")) continue;
      if (/_(zero|one|two|few|many|other)$/.test(key)) continue;
      checked++;
      const got = translate(locale, key, {});
      if (got !== raw && divergences.length < 10) {
        divergences.push(`${locale} ${key}: ${JSON.stringify(raw)} -> ${JSON.stringify(got)}`);
      }
    }
  }
  assert.equal(checked, expected, `expected to cover the whole catalog, saw ${checked} of ${expected}`);
  assert.deepEqual(divergences, [], `literal text was rewritten: ${divergences.join(" | ")}`);
});

test("plural folding follows i18next's category fallback", () => {
  const flat = {
    k_one: "one",
    k_other: "other",
    bare: "singular",
    bare_other: "plural",
    only_other: "always",
  };
  // `en` selects one + other, so both keys fold into two forms. The base name is
  // the key with the suffix stripped — `only_other` becomes `only`.
  assert.deepEqual(toVueI18nMessages(flat, "en"), {
    k: "one | other",
    bare: "singular | plural",
    only: "always | always",
  });
  // `zh-CN` selects only `other`, so one form is emitted per key.
  assert.deepEqual(toVueI18nMessages(flat, "zh-CN"), {
    k: "other",
    bare: "plural",
    only: "always",
  });
  // The form a single-category locale emits is still escaped: the literal `@`
  // becomes vue-i18n's literal syntax while `{{count}}` stays interpolatable,
  // and the `_one` form zh-CN cannot select is not emitted at all.
  assert.deepEqual(
    toVueI18nMessages({ k_one: "one {{count}}", k_other: "other @ {{count}}" }, "zh-CN"),
    { k: "other {'@'} {count}" },
  );
});

test("an incompletely written plural base never produces an empty form", () => {
  // vue-i18n rejects an empty plural form ("Plural must have messages"), and the
  // throw takes out EVERY count for the key — so one missing form turns a key
  // into a render-time crash rather than a degraded string. No shipped catalog
  // hits this today (both catalogs write `_one` + `_other`), but a translator
  // adding a lone `_one` would.
  const shapes = [
    ["en", { k_one: "ONE" }],
    ["en", { k_other: "OTHER" }],
    ["en", { k_one: "", k_other: "OTHER" }],
    ["zh-CN", { k_one: "ONE" }],
  ];
  const failures = [];
  for (const [locale, flat] of shapes) {
    const converted = toVueI18nMessages(flat, locale);
    // A single empty form is the intended degenerate result: a plain empty
    // message, which renders instead of throwing. What must never appear is an
    // empty form *inside* a plural list — that is the shape vue-i18n rejects.
    const emptyForm = converted.k.includes(" | ") && converted.k.split(" | ").some((form) => form === "");
    if (emptyForm) failures.push(`${locale} ${JSON.stringify(flat)} -> ${JSON.stringify(converted.k)}`);

    const instance = createI18n({ legacy: false, locale, fallbackLocale: "en", missingWarn: false, fallbackWarn: false });
    instance.global.setLocaleMessage(locale, converted);
    for (const count of [0, 1, 5]) {
      try {
        instance.global.t("k", { count });
      } catch (error) {
        failures.push(`${locale} ${JSON.stringify(flat)} @${count}: ${String(error.message).split("\n")[0]}`);
      }
    }
  }
  assert.deepEqual(failures, [], `empty plural forms: ${failures.join(" | ")}`);
});

test("no plural suffix survives into the converted catalogs", () => {
  // Structural counterpart to the folding test above, and the only assertion that
  // catches "placeholders converted but plural keys left alone" — that regression
  // throws nothing and echoes no key, so the generic checks are blind to it.
  // A leftover `_one`/`_other` key means the fold never ran.
  const SUFFIX = /_(zero|one|two|few|many|other)$/;
  const leftovers = [];
  const unfolded = [];
  let bases = 0;
  for (const [locale, catalog] of Object.entries(messages)) {
    for (const key of Object.keys(catalog)) {
      if (SUFFIX.test(key) && leftovers.length < 10) leftovers.push(`${locale} ${key}`);
    }
    // A locale with a single category legitimately folds to one form, so only
    // multi-category locales must produce a pipe-separated list.
    const multi = new Intl.PluralRules(locale).resolvedOptions().pluralCategories.length > 1;
    for (const key of Object.keys(flattenCatalog(catalogs[locale]))) {
      if (!SUFFIX.test(key)) continue;
      const base = key.replace(SUFFIX, "");
      bases++;
      const folded = catalog[base];
      const ok = typeof folded === "string" && (!multi || folded.includes(" | "));
      if (!ok && unfolded.length < 10) unfolded.push(`${locale} ${base}: ${JSON.stringify(folded)}`);
    }
  }
  assert.ok(bases > 100, `expected plural bases to cover, saw ${bases}`);
  assert.deepEqual(leftovers, [], `plural keys were not folded: ${leftovers.join(" | ")}`);
  assert.deepEqual(unfolded, [], `plural bases did not fold to multiple forms: ${unfolded.join(" | ")}`);
});

test("the plural rule is the index of the count's CLDR category", () => {
  // The rule and the folding must agree on the form order, or counts select the
  // wrong string even though every message compiles.
  assert.equal(pluralRules.en(0), 1);
  assert.equal(pluralRules.en(1), 0);
  assert.equal(pluralRules.en(5), 1);
  // Chinese has a single category, so every count is form 0.
  assert.equal(pluralRules["zh-CN"](1), 0);
  assert.equal(pluralRules["zh-CN"](5), 0);
});

test("every plural base has exactly one form per category, so no count overruns", () => {
  // The folding writes one form per category and the rule returns a category
  // index. If those lengths ever diverge, a count indexes past the end of the
  // form list, and vue-i18n throws "Unexpected return type in composer" at
  // render time — for a message that compiled fine.
  const SUFFIX = /_(zero|one|two|few|many|other)$/;
  const counts = [0, 1, 2, 5, 11, 21, 100, 101, 1000, 1_000_000];
  const mismatches = [];
  const overruns = [];
  let bases = 0;
  for (const { id } of supportedLocales) {
    const categories = new Intl.PluralRules(id).resolvedOptions().pluralCategories.length;
    const names = new Set();
    for (const key of Object.keys(flattenCatalog(catalogs[id]))) {
      const match = key.match(SUFFIX);
      if (match) names.add(key.slice(0, -match[0].length));
    }
    i18n.global.locale.value = id;
    for (const base of names) {
      bases++;
      const forms = (messages[id][base] ?? "").split(" | ").length;
      if (forms !== categories) {
        mismatches.push(`${id} ${base}: ${forms} forms, ${categories} categories`);
      }
      for (const count of counts) {
        try {
          i18n.global.t(base, { count });
        } catch (error) {
          if (overruns.length < 5) overruns.push(`${id} ${base} @${count}: ${String(error.message).split("\n")[0]}`);
        }
      }
    }
  }
  assert.ok(bases > 50, `expected plural bases to cover, saw ${bases}`);
  assert.deepEqual(mismatches, [], `form/category count mismatch: ${mismatches.join(" | ")}`);
  assert.deepEqual(overruns, [], `plural lookups threw: ${overruns.join(" | ")}`);
});

test("the catalogs stay byte-identical to the i18next dialect", () => {
  // The conversion exists so the catalogs never have to change. If a catalog were
  // rewritten to the vue-i18n dialect in place, the two trees would drift and the
  // main process — which reads the catalogs directly and does its own
  // `.replace("{name}", ...)` interpolation — would silently lose its strings.
  //
  // Every locale is checked, not just `en`: the drift would otherwise be caught
  // only for the locale someone happened to look at.
  const missing = [];
  for (const { id } of supportedLocales) {
    const source = readFileSync(new URL(`../src/i18n/locales/${id}/index.ts`, import.meta.url), "utf8");
    // i18next `{{name}}` placeholders, i18next plural keys, and the single-brace
    // strings the main process interpolates itself.
    if (!/\{\{\w+\}\}/.test(source)) missing.push(`${id}: no i18next placeholder`);
    if (!/_one:/.test(source)) missing.push(`${id}: no i18next plural key`);
    if (!/\{name\}/.test(source)) missing.push(`${id}: no single-brace consent string`);
    // vue-i18n's own dialect must never appear in a catalog.
    if (/\{'/.test(source)) missing.push(`${id}: contains a vue-i18n literal escape`);
  }
  assert.deepEqual(missing, [], `catalogs left the i18next dialect: ${missing.join(" | ")}`);

  // The `<Trans>` tag form is part of the dialect too: it is i18next's own
  // component syntax, and only the renderer conversion knows to leave it alone.
  const en = readFileSync(new URL("../src/i18n/locales/en/index.ts", import.meta.url), "utf8");
  assert.match(en, /<highlight>\{\{tool\}\}<\/highlight>/, "catalogs keep the Trans tag form");
  assert.match(en, /\{name\} wants to run \{operation\}/, "main-process consent strings use single braces");
});
