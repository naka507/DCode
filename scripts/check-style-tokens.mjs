#!/usr/bin/env node
/**
 * Style token guard: forbids raw typography/radius literals in the desktop
 * renderer. All values must come from the token scales defined in the
 * `@theme` block of styles/tokens.css (see docs/spec/04-ux/07-ui-design-system.md).
 *
 * Checked:
 *  - CSS: tokenized settings/composer/plugin search fills cannot contain raw
 *    hex, color functions, white, or black (see style-surface-tokens.mjs).
 *  - CSS: font-size / font-weight / line-height / letter-spacing /
 *    border-radius values must be var(...) based (token definitions on
 *    `--custom-property` lines are exempt).
 *  - Vue: the same two rules inside every `<style>` block, and arbitrary-value
 *    utilities text-[...], rounded-[...], leading-[...], tracking-[...],
 *    font-[...] anywhere in the SFC are forbidden.
 *
 * `src/renderer` is the scan root because that is where the renderer lives;
 * any other path would make this guard silently pass by finding no files at
 * all.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { findLiteralSurfaceColors } from "./style-surface-tokens.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src/renderer");

const CSS_PROPS = /^\s*(font-size|font-weight|line-height|letter-spacing|border-radius)\s*:\s*([^;]+);?/;
const ARBITRARY_UTILITY = /\b(?:text|rounded|leading|tracking|font)-\[[^\]]+\]/g;
const ALLOWED_BARE = new Set(["0", "!important", "inherit", "initial", "unset", "normal", "none"]);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(css|vue)$/.test(e.name) ? [p] : [];
  });
}

function stripVars(value) {
  let prev;
  do {
    prev = value;
    value = value.replace(/var\([^()]*\)/g, " ");
  } while (value !== prev);
  return value;
}

/**
 * CSS text of one file as `[lineNumber, text]` pairs.
 *
 * A stylesheet is CSS from top to bottom; an SFC contributes only its
 * `<style>` blocks, so a `<script>` template literal that happens to hold
 * `border-radius:` is not reported against the wrong line.
 */
function cssRegions(file, source) {
  const lines = source.split("\n");
  if (file.endsWith(".css")) return lines.map((text, i) => [i + 1, text]);
  const regions = [];
  let depth = 0;
  let startLine = 0;
  lines.forEach((text, i) => {
    if (depth === 0 && /<style\b[^>]*>/.test(text)) {
      startLine = i + 2; // first line after the opening tag
      depth = 1;
      return;
    }
    if (depth === 1 && /<\/style>/.test(text)) {
      depth = 0;
      return;
    }
    if (depth === 1 && i + 1 >= startLine) regions.push([i + 1, text]);
  });
  return regions;
}

const violations = [];

for (const file of walk(srcDir)) {
  const rel = relative(root, file);
  const source = readFileSync(file, "utf8");
  const regions = cssRegions(file, source);
  const cssText = regions.map(([, text]) => text).join("\n");
  for (const violation of findLiteralSurfaceColors(cssText)) {
    violations.push(
      `${rel}:${violation.line} raw ${violation.property} value "${violation.value}" — use a surface token`,
    );
  }
  // `@font-face` descriptors describe the font file (weight ranges, etc.),
  // not UI typography, so they are exempt from the token scale.
  let inFontFace = 0;
  for (const [lineNumber, line] of regions) {
    if (/^\s*--/.test(line)) continue; // token definition
    if (/@font-face\s*\{/.test(line)) inFontFace += 1;
    if (inFontFace > 0) {
      if (/\}/.test(line)) inFontFace -= 1;
      continue;
    }
    const m = line.match(CSS_PROPS);
    if (!m) continue;
    const rest = stripVars(m[2]).trim();
    const bad = rest.split(/\s+/).filter((t) => t && !ALLOWED_BARE.has(t));
    if (bad.length) {
      violations.push(`${rel}:${lineNumber} raw ${m[1]} value "${m[2].trim()}" — use a token var`);
    }
  }
  source.split("\n").forEach((line, i) => {
    for (const hit of line.match(ARBITRARY_UTILITY) ?? []) {
      violations.push(`${rel}:${i + 1} arbitrary utility "${hit}" — use a token utility class`);
    }
  });
}

if (violations.length) {
  console.error("Style token violations:\n" + violations.map((v) => `  ${v}`).join("\n"));
  console.error(`\n${violations.length} violation(s). Use the scales in styles/tokens.css @theme.`);
  process.exit(1);
}
console.log("style tokens OK");
