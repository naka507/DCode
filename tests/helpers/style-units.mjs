/**
 * Inline-style unit contract parsing, shared by `tests/vue-style-units.test.mjs`.
 *
 * Vue writes an object style binding straight to CSSOM, property by property
 * (`style.top = value`). CSSOM rejects a unitless length for a length property
 * and drops the declaration **silently** — no error, no warning, and the
 * element keeps whatever the stylesheet says. React, which this renderer's
 * markup was translated from, appends `px` to a numeric length for you, so a
 * number that was correct there renders nothing here.
 *
 * The failure this guards against is exactly that translation gap: a binding
 * such as `:style="{ top: menuPosition.top }"` produces a `position: fixed`
 * menu with no `top`, so the menu paints at its static position — at the bottom
 * of the document — instead of beside its trigger.
 *
 * Both directions are heuristics over source text, so they are deliberately
 * biased to the forms this codebase actually uses and unit-tested against the
 * adversarial fixtures in the test file.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const rendererRoot = fileURLToPath(new URL("../../src/renderer/", import.meta.url));
/**
 * Documented exceptions, keyed by renderer-relative path.
 *
 * `shorthands` lists length properties bound in shorthand form (`{ width }`)
 * whose values are known to carry units; `spreads` lists spreads whose members
 * are known to carry units. Both lists are exhaustive, so an allowlisted file
 * may not add another one without failing the contract — the list cannot be
 * used as a blanket opt-out.
 */
export const STYLE_BINDING_ALLOWLIST = {
  "features/chat/transcript/ChatTranscript.vue": {
    reason:
      "`{ width }` is a shorthand over TRANSCRIPT_SKELETON_ROWS, whose `lines` are percentage strings like \"46%\" — the unit is in the data, which source text cannot show.",
    shorthands: ["width"],
    spreads: [],
  },
};


/**
 * Properties that take a `<length>`. Compared with dashes removed and
 * lowercased, so `border-radius` and `borderRadius` are one entry.
 *
 * Deliberately excluded: `background-size`, `flex`, `grid-*`, `transform` and
 * the SVG presentation attributes, whose grammars are lists or keywords where a
 * bare number is not the mistake this contract is about.
 */
export const LENGTH_PROPERTIES = new Set([
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "insettop",
  "insetright",
  "insetbottom",
  "insetleft",
  "insetinline",
  "insetblock",
  "width",
  "height",
  "minwidth",
  "maxwidth",
  "minheight",
  "maxheight",
  "margin",
  "margintop",
  "marginright",
  "marginbottom",
  "marginleft",
  "margininline",
  "marginblock",
  "padding",
  "paddingtop",
  "paddingright",
  "paddingbottom",
  "paddingleft",
  "paddinginline",
  "paddingblock",
  "gap",
  "rowgap",
  "columngap",
  "fontsize",
  "lineheight",
  "letterspacing",
  "wordspacing",
  "textindent",
  "borderradius",
  "borderwidth",
  "bordertopwidth",
  "borderrightwidth",
  "borderbottomwidth",
  "borderleftwidth",
  "outlineoffset",
  "outlinewidth",
  "flexbasis",
  "columnwidth",
  "columnheight",
  "scrollmargin",
  "scrollpadding",
]);

/**
 * A length unit, or a CSS function that yields one.
 *
 * The lookarounds keep a unit from matching inside an identifier: `Inter` does
 * not end in `in`, and `FONT_OPTION_ROW_HEIGHT` does not contain `pt`. The same
 * guard keeps the function names from matching a *method* of the same name, so
 * `Math.min(a, b)` is not mistaken for the CSS `min()` — a plain
 * `Math.max(...)` interpolation is a unitless number and must be reported.
 *
 * `%` must directly follow a digit or a closing interpolation brace, because in
 * JavaScript source `index % 2` is a modulo, not a percentage.
 */
const UNIT_OR_FUNCTION =
  /(?:(?<![A-Za-z])(?:px|em|rem|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc|q)(?![A-Za-z]))|(?<=[\d}])%|(?<![\w$.])(?:calc|var|min|max|clamp|env)\(/;

/** Values that need no unit at all. */
const UNITLESS_KEYWORDS =
  /^(?:auto|none|inherit|initial|unset|revert|revert-layer|fit-content|max-content|min-content|thin|medium|thick)$/i;

const NUMBER_LITERAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const STRING_LITERAL = /^(["'`])([\s\S]*)\1$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Split an object-literal body into its top-level entries.
 *
 * Tracks nesting and string literals, so a comma inside
 * `translate(-50%, -50%)` or inside `"Segoe UI, sans-serif"` does not split an
 * entry.
 */
export function splitEntries(body) {
  const entries = [];
  let depth = 0;
  let quote = null;
  let buf = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      buf += ch;
      if (ch === "\\") {
        buf += body[++i] ?? "";
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    if (ch === "}" || ch === "]" || ch === ")") depth--;
    if (ch === "," && depth === 0) {
      entries.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  entries.push(buf);
  return entries;
}
/**
 * Spreads in one object-literal body whose members are *not* visible inline.
 *
 * `...position` hides its members behind a name and `...(a ? b : c)` behind an
 * expression, so neither shows the units and both are reported. A spread with
 * an inline object body (`...(a ? { top: 1 } : {})`) is skipped here because
 * {@link braceBodies} already scans those bodies.
 */
export function styleSpreads(body) {
  const spreads = [];
  for (const entry of splitEntries(body)) {
    const trimmed = entry.trim();
    if (!trimmed.startsWith("...")) continue;
    if (braceBodies(trimmed).length > 0) continue;
    spreads.push(trimmed);
  }
  return spreads;
}
/**
 * Every balanced `{...}` body in `text`, outermost first, skipping braces that
 * Every balanced `{...}` body in `text`, outermost first, skipping braces that
 * appear inside a string or a template literal (so a `${...}` interpolation is
 * not mistaken for an object).
 */
export function braceBodies(text) {
  const bodies = [];
  let outerQuote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (outerQuote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === outerQuote) outerQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      outerQuote = ch;
      continue;
    }
    if (ch !== "{") continue;
    let depth = 0;
    let quote = null;
    let end = text.length - 1;
    for (let j = i; j < text.length; j++) {
      const inner = text[j];
      if (quote) {
        if (inner === "\\") {
          j++;
          continue;
        }
        if (inner === quote) quote = null;
        continue;
      }
      if (inner === '"' || inner === "'" || inner === "`") {
        quote = inner;
        continue;
      }
      if (inner === "{") depth++;
      else if (inner === "}") {
        depth--;
        if (depth === 0) {
          bodies.push(text.slice(i + 1, j));
          end = j;
          break;
        }
      }
    }
    // Continue after the body: a `{` inside a nested object is part of it.
    i = end;
  }
  return bodies;
}

function keyOf(entry) {
  const colon = entry.indexOf(":");
  if (colon < 0) return null;
  const raw = entry.slice(0, colon).trim();
  const key = raw.replace(/^["'`]|["'`]$/g, "").trim();
  return key ? { key, value: entry.slice(colon + 1).trim() } : null;
}

/**
 * A value whose units cannot be proven from the source.
 *
 * A string or template literal is judged by its literal text, so `` `${n}px` ``
 * passes while `` `${n}` `` does not. Everything else — a number, an identifier,
 * a member expression, a call — is a finding, because a unit could only come
 * from text that is not here.
 */
function unitless(key, value) {
  if (!value || value === "undefined" || value === "null") return false;
  if (!LENGTH_PROPERTIES.has(key.replace(/-/g, "").toLowerCase())) return false;
  const literal = STRING_LITERAL.exec(value);
  const text = literal ? literal[2] : value;
  if (NUMBER_LITERAL.test(text) && Number(text) === 0) return false;
  if (UNIT_OR_FUNCTION.test(text) || UNITLESS_KEYWORDS.test(text)) return false;
  return true;
}

/**
 * Unitless length declarations inside one object-literal body, plus the
 * shorthand entries (`{ width }`) whose value the entry text does not show.
 */
export function unitlessLengths(body) {
  const found = [];
  for (const entry of splitEntries(body)) {
    const trimmed = entry.trim();
    if (!trimmed || trimmed.startsWith("...")) continue;
    const pair = keyOf(entry);
    if (!pair) {
      // A shorthand names a length property without showing its value.
      const name = trimmed.replace(/^["'`]|["'`]$/g, "").trim();
      if (IDENTIFIER.test(name) && LENGTH_PROPERTIES.has(name.toLowerCase())) {
        found.push({ key: name, value: "(shorthand)" });
      }
      continue;
    }
    if (pair.key.startsWith("--")) continue;
    if (unitless(pair.key, pair.value)) found.push({ key: pair.key, value: pair.value });
  }
  return found;
}

/** `{ line, body }` for every object literal written in a `:style` binding. */
export function templateStyleObjects(source) {
  const start = source.indexOf("<template>");
  if (start < 0) return [];
  const template = source.slice(start);
  const out = [];
  const re = /:style="([\s\S]*?)"(?=\s|\/?>)/g;
  let match;
  while ((match = re.exec(template))) {
    const expression = match[1].trim();
    const line = source.slice(0, start + match.index).split("\n").length;
    for (const body of braceBodies(expression)) out.push({ line, expression, body });
  }
  return out;
}

/**
 * `{ line, name, kind }` for every `:style` binding that names something rather
 * than writing an object inline — either a bare identifier (`menuStyle`) or a
 * call (`groupRowStyle(row)`). Both hide the style object in the script region,
 * so both must be resolved there or the binding is never checked.
 */
export function styleReferences(source) {
  const start = source.indexOf("<template>");
  if (start < 0) return [];
  const template = source.slice(start);
  const out = [];
  const re = /:style="([A-Za-z_$][\w$]*)(\([\s\S]*?\))?\s*"/g;
  let match;
  while ((match = re.exec(template))) {
    out.push({
      name: match[1],
      kind: match[2] === undefined ? "value" : "call",
      line: source.slice(0, start + match.index).split("\n").length,
    });
  }
  return out;
}

/**
 * The declaration text behind a `:style` reference, or `null` when it cannot be
 * read. Handles `const NAME = ...`, `function NAME(...) {...}` and
 * `const NAME = (...) => ...`, which are the three shapes this tree uses.
 */
export function styleReferenceBody(source, name) {
  const fn = new RegExp(`\\bfunction\\s+${name}\\s*\\([\\s\\S]*?\\n\\}`).exec(source);
  if (fn) return fn[0];
  const declaration = new RegExp(
    `\\bconst\\s+${name}\\s*=\\s*([\\s\\S]*?)\\n(?=\\s*(?:const|let|function|watch|watchEffect|onMounted|onUnmounted|onBeforeUnmount|/\\*|//|</script>))`,
  ).exec(source);
  if (declaration) return declaration[1];
  const single = new RegExp(`\\bconst\\s+${name}\\s*=\\s*([^;\\n]*)`).exec(source);
  return single ? single[1] : null;
}

/**
 * Findings for one file.
 *
 * `findings` are unitless lengths and shorthand length properties. `unresolved`
 * are `:style` references whose declaration could not be read, plus spreads
 * whose member values live elsewhere — the caller fails on both, because an
 * unreadable binding is exactly the case this contract cannot clear.
 */
export function styleUnitFindings(path, root = rendererRoot) {
  const source = readFileSync(path, "utf8");
  const relative = path.slice(root.length).replace(/\\/g, "/");
  const allow = STYLE_BINDING_ALLOWLIST[relative];
  const allowedShorthands = new Set(allow?.shorthands ?? []);
  const allowedSpreads = new Set(allow?.spreads ?? []);
  const findings = [];
  const unresolved = [];

  const scan = (body, context) => {
    for (const hit of unitlessLengths(body)) {
      if (hit.value === "(shorthand)" && allowedShorthands.has(hit.key)) continue;
      findings.push({ ...context, ...hit });
    }
    for (const spread of styleSpreads(body)) {
      if (allowedSpreads.has(spread)) continue;
      unresolved.push({ ...context, name: spread });
    }
  };

  for (const { line, body } of templateStyleObjects(source)) scan(body, { line });
  for (const { name, line, kind } of styleReferences(source)) {
    const declaration = styleReferenceBody(source, name);
    if (declaration === null) {
      unresolved.push({ line, name: `${name}${kind === "call" ? "(...)" : ""}` });
      continue;
    }
    for (const body of braceBodies(declaration)) scan(body, { line, name });
  }
  return { findings, unresolved };
}

/** Every `.vue` file under the renderer, as absolute paths. */
export function vueFiles(root = rendererRoot) {
  const out = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".vue")) out.push(path);
    }
  })(root);
  return out.sort();
}
