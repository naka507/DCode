/**
 * vue-i18n instance for the renderer.
 *
 * The catalogs live in `@dcode/i18n` (framework-agnostic) and are written
 * in the i18next dialect the catalogs are written in: `{{name}}` interpolation,
 * `_one` / `_other` plural keys, and literal `@`, `|` and `{` in ordinary prose.
 * vue-i18n gives every one of those a different meaning, so this module owns the
 * Vue binding, the message format, and the translation of that dialect into what
 * vue-i18n compiles. The catalogs are the single source of truth, so the dialect
 * and the compiled form cannot drift.
 *
 * Three parts, all required:
 *
 *   1. `toVueI18nMessages` rewrites each message and folds plural keys into
 *      pipe-separated forms.
 *   2. `pluralRules` supplies the CLDR plural rule i18next already used, because
 *      with i18next for real locales (Chinese has no `one` category, so a
 *      count of 1 reads the `other` form).
 *   3. The catalogs are installed into the instance at import time, below. Doing
 *      it there rather than at the call site means a consumer cannot end up with
 *      a usable-looking instance that renders every key as its own name.
 */
import { catalogs, flattenCatalog, supportedLocales, type AppLocale } from "@dcode/i18n";
import { createI18n } from "vue-i18n";

/**
 * i18next plural suffixes in CLDR order.
 *
 * The order is the contract: a converted message is a pipe-separated list whose
 * index is the position of the count's CLDR category in this sequence, so the
 * rule below and the folding above must agree on it.
 */
const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"] as const;

type PluralSuffix = (typeof PLURAL_SUFFIXES)[number];

const PLURAL_KEY = new RegExp(`_(?:${PLURAL_SUFFIXES.join("|")})$`);

/**
 * The CLDR categories a locale actually selects, in `PLURAL_SUFFIXES` order.
 *
 * `Intl.PluralRules` reports the categories as a set, so the sequence is imposed
 * here rather than taken from the runtime.
 */
function pluralCategories(locale: AppLocale): PluralSuffix[] {
  const available = new Set(
    new Intl.PluralRules(locale).resolvedOptions().pluralCategories,
  );
  return PLURAL_SUFFIXES.filter((suffix) => available.has(suffix));
}

/** `{{name}}` in the i18next dialect, captured so it survives escaping. */
const I18NEXT_PLACEHOLDER = /\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}/g;

/**
 * A converted placeholder parked behind a sentinel while the rest of the
 * message is escaped. `\u0000` cannot occur in a catalog string, and escaping
 * runs before the sentinel is restored, so a placeholder's own braces are never
 * mistaken for a literal.
 */
const SENTINEL_OPEN = "\u0000";
const SENTINEL_CLOSE = "\u0001";

/**
 * Characters vue-i18n gives a meaning to that i18next treats as plain text.
 *
 * `@` starts a linked message, `|` separates plural forms, and a bare brace
 * opens an interpolation. Each becomes the literal form `{'x'}` vue-i18n
 * renders verbatim. This matters for real catalog text — "Type / for commands
 * · @ for files" is a linked-message syntax error, and the shipped
 * `summary ≈{tokens}} tokens` string is an unbalanced-brace error, not a
 * placeholder.
 *
 * One pass, not a `replace` chain: a chain would re-escape the braces it just
 * inserted (`{` -> `{'{'}` -> `{'{'{'}'}`) and every placeholder-bearing
 * message would fail to compile.
 */
function escapeLiterals(message: string): string {
  return message.replace(/[{}\|@]/g, (char) => `{'${char}'}`);
}

/** One i18next message in the vue-i18n dialect. */
export function toVueI18nMessage(message: string): string {
  const parked = message.replace(
    I18NEXT_PLACEHOLDER,
    (_whole, name: string) => `${SENTINEL_OPEN}${name}${SENTINEL_CLOSE}`,
  );
  return escapeLiterals(parked).replace(
    new RegExp(`${SENTINEL_OPEN}([A-Za-z_$][\\w$]*)${SENTINEL_CLOSE}`, "g"),
    "{$1}",
  );
}

/**
 * Convert one locale's flattened catalog.
 *
 * Plural keys are folded into their base name as pipe-separated forms, one per
 * category the locale selects. For a count whose category is `C`, i18next
 * resolves `key_C`, then the bare `key`; if neither exists the lookup misses and
 * the *fallback language* answers it. That was verified against the real i18next
 * runtime, not assumed:
 *
 *   - `key_one` / `key_other`  ->  the `one` and `other` slots.
 *   - `key` + `key_other`      ->  the bare key fills the singular slot, because
 *     i18next falls back to the *bare* key when no `_one` exists. Dropping the
 *     base here silently turned "1 step" into "1 steps".
 *   - `key_other` alone        ->  the remaining slots borrow the `other` text.
 *
 * That last rule exists because vue-i18n rejects an empty plural form outright,
 * so a category the locale selects but the catalog never wrote has to borrow a
 * sibling form rather than degrade to an empty slot. With only English and
 * Simplified Chinese shipping, every category either catalog selects is written
 * by that catalog, so the borrow only fires for a partially-written key.
 */
export function toVueI18nMessages(
  flat: Record<string, string>,
  locale: AppLocale,
): Record<string, string> {
  const categories = pluralCategories(locale);
  const out: Record<string, string> = {};
  const pluralForms = new Map<string, Map<string, string>>();

  for (const [key, value] of Object.entries(flat)) {
    const match = key.match(PLURAL_KEY);
    if (!match) {
      out[key] = toVueI18nMessage(value);
      continue;
    }
    const base = key.slice(0, -match[0].length);
    const bucket = pluralForms.get(base) ?? new Map<string, string>();
    bucket.set(match[0].slice(1), toVueI18nMessage(value));
    pluralForms.set(base, bucket);
  }

  for (const [base, bucket] of pluralForms) {
    const bare = out[base];
    const forms = categories.map(
      (category) => bucket.get(category) ?? bare ?? bucket.get("other") ?? "",
    );
    // vue-i18n rejects an empty plural form outright ("Plural must have
    // messages"), and that throw takes out *every* count for the key, not just
    // the count whose form is missing — the same invisible-until-rendered class
    // of failure this module exists to remove. So a category the catalog never
    // wrote degrades to a sibling form instead of to an empty slot. If the whole
    // key is empty, emit a plain (non-plural) empty message rather than " | ".
    const filled = forms.some((form) => form !== "")
      ? forms.map((form) => form || forms.find((other) => other !== "")!)
      : [""];
    out[base] = filled.join(" | ");
  }

  return out;
}

/**
 * The CLDR plural rule per shipped locale, replacing vue-i18n's built-in
 * singular/plural split.
 *
 * vue-i18n asks for an index into the message's form list, so the rule is the
 * position of the count's CLDR category among the categories the locale selects
 * — the same order `toVueI18nMessages` wrote the forms in.
 *
 * The option is `pluralRules` because this instance is `legacy: false`; the
 * Composition API reads `pluralRules`, while the legacy option is
 * `pluralizationRules` and is silently ignored here (verified against the
 * installed vue-i18n, where the legacy name left the rule uncalled).
 */
export const pluralRules = supportedLocales.reduce(
  (rules, { id }) => {
    const categories = pluralCategories(id);
    const plural = new Intl.PluralRules(id);
    rules[id] = (choice: number) => {
      const index = categories.indexOf(plural.select(choice) as PluralSuffix);
      // A category the locale reports but the list omits can only happen if
      // the two disagree; fall back to the last form rather than throwing.
      return index < 0 ? Math.max(categories.length - 1, 0) : index;
    };
    return rules;
  },
  {} as Record<AppLocale, (choice: number, choicesLength: number) => number>,
);

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: "en",
  fallbackLocale: "en",
  pluralRules,
  // Catalogs are already complete in every shipped locale; missing-key warnings
  // would only add noise for keys the shell resolves on the main-process side.
  missingWarn: false,
  fallbackWarn: false,
});

/** Every shipped catalog, flattened and translated for this instance. */
export function rendererMessages(): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(catalogs).map(([locale, catalog]) => [
      locale,
      toVueI18nMessages(
        flattenCatalog(catalog as unknown as Record<string, unknown>),
        locale as AppLocale,
      ),
    ]),
  );
}

/**
 * Install every catalog into the instance.
 *
 * This runs at import time rather than at the call site on purpose. `t()`
 * compiles a message lazily, so an instance that was never given messages does
 * not fail loudly — it renders each key back as its own name, and every screen
 * looks translated-but-empty instead of broken. Importing this module therefore
 * has to be enough to get a working instance; `main.ts` only picks the locale.
 */
for (const [locale, messages] of Object.entries(rendererMessages())) {
  i18n.global.setLocaleMessage(locale, messages);
}
