/**
 * Stylesheet structure: every rule prelude must be at top level.
 *
 * `tests/vue-class-contract.test.mjs` collects class names from any `{`-prelude
 * regardless of nesting depth, and the page contracts slice text between a
 * prelude and the next `}`, so neither can tell a top-level rule from one that
 * was accidentally inserted *inside* another rule's declaration block. That has
 * happened twice, and both times every existing guard stayed green:
 *
 *   - the remote-host block landed inside `.settings-row`;
 *   - `model-config.css` gained a duplicated `.provider-chosen-remove:focus-visible`
 *     selector, which left the multi-selector block above it unclosed and nested
 *     every rule from there to the end of the file.
 *
 * Under native CSS nesting the nested rules keep parsing, they just stop
 * matching — so the page renders unstyled rather than failing loudly.
 *
 * The check is depth-based, not textual: a `{` at depth 0 opens a top-level
 * rule and its prelude must be flush-left, so a rule that opens while another
 * is still open is reported with its line number. At-rules (`@media`, `@supports`)
 * legitimately contain rules, so their contents are not flagged.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const STYLE_DIR = join(here, "..", "src", "renderer", "styles");

/** Files whose rules are checked. Partials only; `globals.css` is the entry. */
function styleFiles() {
  return readdirSync(STYLE_DIR)
    .filter((name) => name.endsWith(".css"))
    .sort();
}

/**
 * Strip comments so a `{` inside prose (for example a selector written in a
 * comment) cannot shift the depth count.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
}

/**
 * Report every rule prelude that opens while another rule is already open and
 * is not inside an at-rule block, which is the accidental-nesting signature.
 *
 * Returns `{ line, prelude }` entries, 1-based line numbers.
 */
function nestedRulePreludes(text) {
  const source = withoutComments(text);
  const findings = [];
  /** Stack of open blocks: `{ kind: "rule" | "at", line }`. */
  const stack = [];
  let line = 1;
  let preludeStart = 0;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\n") {
      line++;
      continue;
    }
    if (ch === "{") {
      const prelude = source.slice(preludeStart, i).trim();
      const isAtRule = prelude.startsWith("@");
      // A rule opening inside another *rule* (not an at-rule) is the defect.
      const insideRule = stack.some((block) => block.kind === "rule");
      if (!isAtRule && insideRule) {
        findings.push({ line, prelude: prelude.split("\n").pop().trim() });
      }
      stack.push({ kind: isAtRule ? "at" : "rule", line });
      preludeStart = i + 1;
      continue;
    }
    if (ch === "}") {
      stack.pop();
      preludeStart = i + 1;
      continue;
    }
  }

  return findings;
}

test("no stylesheet rule is nested inside another rule", () => {
  const offenders = [];
  for (const name of styleFiles()) {
    const text = readFileSync(join(STYLE_DIR, name), "utf8");
    for (const finding of nestedRulePreludes(text)) {
      offenders.push(`${name}:${finding.line} ${finding.prelude}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("every stylesheet keeps balanced braces", () => {
  const unbalanced = [];
  for (const name of styleFiles()) {
    const source = withoutComments(readFileSync(join(STYLE_DIR, name), "utf8"));
    let depth = 0;
    let min = 0;
    for (const ch of source) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth < min) min = depth;
      }
    }
    if (depth !== 0 || min < 0) unbalanced.push(`${name}: final=${depth} min=${min}`);
  }
  assert.deepEqual(unbalanced, []);
});

test("the nesting check actually detects a nested rule", () => {
  // Guards the guard: if the scanner stopped reporting nesting, the two checks
  // above would pass vacuously.
  const nested = ".a {\n  color: red;\n\n.b {\n    color: blue;\n  }\n}\n";
  const findings = nestedRulePreludes(nested);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].prelude, ".b");

  // A legitimate at-rule child is not reported.
  assert.deepEqual(nestedRulePreludes(".a {\n  color: red;\n}\n@media (max-width: 720px) {\n  .a {\n    color: blue;\n  }\n}\n"), []);

  // A `{` inside a comment does not shift the depth.
  assert.deepEqual(nestedRulePreludes("/* .x { */\n.a {\n  color: red;\n}\n"), []);
});
