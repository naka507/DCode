import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The renderer module graph.
 *
 * The failure this guards against is the one the Vue port actually produced: a
 * component imports a module that does not exist. `AppShell.vue` was committed
 * referencing nine unported files (`Sidebar.vue`, `ChatSurface.vue`,
 * `SearchDialog.vue`, `WindowControls.vue`, `workpanel/WorkPanel.vue` and the
 * four `pages/*.vue`), which made `electron-vite build` fail outright with
 * `Could not resolve "../../components/ChatSurface.vue"`.
 *
 * Nothing in the suite caught it. `vue-class-contract` reads a template's class
 * attributes and never parses its imports; `renderer-automation-surface` only
 * inspects `capture/*` and `useAppShellRuntime.ts`. So the repository could be
 * — and was — unable to build while `npm test` reported a clean run.
 *
 * This file closes that hole: it resolves every relative import in the renderer
 * tree against the filesystem, which is exactly what the bundler does.
 */

const rendererRoot = fileURLToPath(new URL("../src/renderer/", import.meta.url));

/** Files whose text can contain an import statement. */
const SOURCE_EXTENSIONS = [".ts", ".vue", ".js", ".mjs"];

/** Extensions a bundler will try when a specifier has no extension. */
const RESOLUTION_SUFFIXES = [".ts", ".vue", ".js", ".mjs", ".css", ".json", ".html"];

/**
 * `from "..."`, `import("...")` and side-effect `import "..."`.
 *
 * All three forms appear in this tree — the shell uses `import` for components
 * and `defineAsyncComponent(() => import(...))` for route pages, and
 * `main.ts` uses a side-effect import for the stylesheet.
 *
 * `from\b` carries a word boundary so prose in a comment or a string (`see
 * from "./x"`) is not read as an import. The other two branches are keyword-led
 * and already unambiguous.
 *
 * Relative specifiers only. The bare aliases (`@dcode/*`, `@renderer/*`)
 * are resolved against the tables in `electron.vite.config.ts` and
 * `tsconfig.json` by `aliasSpecifierTargets` below.
 */
const IMPORT_SPECIFIER =
  /(?:from\b\s*|import\s*\(\s*|import\s+)(["'])([^"']+)\1/g;

/** Only these are resolvable relative to the importing file. */
const isRelativeSpecifier = (specifier) => /^\.\.?\//.test(specifier);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * A file or a directory.
 *
 * `@renderer` is a directory alias (`src/renderer`), so the alias-target check
 * cannot require a file.
 */
function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Where a specifier points, or `null` when nothing on disk answers it. */
function resolveSpecifier(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  if (isFile(base)) return base;
  for (const suffix of RESOLUTION_SUFFIXES) {
    if (isFile(base + suffix)) return base + suffix;
  }
  for (const suffix of RESOLUTION_SUFFIXES) {
    if (isFile(join(base, `index${suffix}`))) return join(base, `index${suffix}`);
  }
  return null;
}

/**
 * The alias tables the bundler and `tsc` actually resolve against.
 *
 * Mirrors `electron.vite.config.ts`'s `packageAliases` plus its renderer-only
 * `@renderer` entry, and `tsconfig.json`'s `paths`. Order matters: the vite
 * comment above that table notes subpath entries must precede the bare entry,
 * because alias matching is prefix-based. The same ordering is kept here.
 *
 * `prefix` is matched with `startsWith`; `target` is a workspace-relative path.
 */
const ALIASES = [
  { prefix: "@dcode/shared/protocol", target: "src/shared/protocol.ts" },
  { prefix: "@dcode/shared/theme", target: "src/shared/theme.ts" },
  { prefix: "@dcode/shared", target: "src/shared/index.ts" },
  { prefix: "@dcode/i18n", target: "src/i18n/index.ts" },
  { prefix: "@dcode/engine", target: "src/engine/index.ts" },
  { prefix: "@dcode/host-runtime", target: "src/engine/index.ts" },
  { prefix: "@dcode/agent-runtime", target: "src/agent/runtime/index.ts" },
  { prefix: "@dcode/agent/runtime", target: "src/agent/runtime/index.ts" },
  { prefix: "@dcode/agent-host", target: "src/agent/host/index.ts" },
  { prefix: "@dcode/agent/host", target: "src/agent/host/index.ts" },
  { prefix: "@dcode/racp", target: "src/racp/index.ts" },
  { prefix: "@dcode/plugin-sdk", target: "src/plugin/sdk/index.ts" },
  { prefix: "@dcode/plugin/sdk", target: "src/plugin/sdk/index.ts" },
  { prefix: "@dcode/plugin-devkit", target: "src/plugin/devkit/index.ts" },
  { prefix: "@dcode/plugin/devkit", target: "src/plugin/devkit/index.ts" },
  { prefix: "@renderer", target: "src/renderer" },
];

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));

/** Where an alias specifier points, or `null` when it is not an alias. */
function resolveAlias(specifier) {
  for (const { prefix, target } of ALIASES) {
    if (specifier === prefix || specifier.startsWith(`${prefix}/`)) {
      const rest = specifier.slice(prefix.length).replace(/^\//, "");
      return resolve(workspaceRoot, target, rest);
    }
  }
  return null;
}

/** The alias prefixes in declaration order, longest first. */
const ALIAS_PREFIXES = ALIASES.map((entry) => entry.prefix).sort(
  (a, b) => b.length - a.length,
);

const sourceFiles = walk(rendererRoot).filter((file) =>
  SOURCE_EXTENSIONS.includes(file.slice(file.lastIndexOf("."))),
);

const rendererPath = (file) => relative(rendererRoot, file).split("\\").join("/");

test("the module graph walk is not empty", () => {
  // A walk that stops finding files would make every assertion below vacuous.
  assert.ok(
    sourceFiles.length > 100,
    `expected the renderer tree to hold many modules, found ${sourceFiles.length}`,
  );
  assert.ok(
    sourceFiles.some((file) => file.endsWith(".vue")),
    "expected the walk to reach .vue components",
  );
});

test("every relative import in the renderer tree resolves", () => {
  const broken = [];
  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[2];
      if (!isRelativeSpecifier(specifier)) continue;
      if (resolveSpecifier(file, specifier) !== null) continue;
      const line = source.slice(0, match.index).split("\n").length;
      broken.push(`${rendererPath(file)}:${line} -> ${specifier}`);
    }
  }
  assert.deepEqual(
    broken,
    [],
    broken.length === 0
      ? undefined
      : "the renderer imports modules that do not exist, so the bundle cannot " +
        `build: ${broken.join(", ")}. Port the surface, or add a placeholder ` +
        "component the way the shell's unported surfaces already are.",
  );
});

test("every aliased import in the renderer tree resolves", () => {
  // Relative imports are only half the graph: `@dcode/*` and `@renderer/*`
  // are resolved by the alias tables in `electron.vite.config.ts` and
  // `tsconfig.json`, so a typo in one is invisible to the sweep above.
  const broken = [];
  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[2];
      if (isRelativeSpecifier(specifier)) continue;
      if (!ALIAS_PREFIXES.some((prefix) => specifier.startsWith(prefix))) continue;
      const base = resolveAlias(specifier);
      if (base !== null && resolveSpecifier(file, base) !== null) continue;
      const line = source.slice(0, match.index).split("\n").length;
      broken.push(`${rendererPath(file)}:${line} -> ${specifier}`);
    }
  }
  assert.deepEqual(
    broken,
    [],
    broken.length === 0
      ? undefined
      : `aliased imports do not resolve against the vite/tsconfig alias tables: ${broken.join(", ")}`,
  );
});

/**
 * The import *clause* and specifier of every static import.
 *
 * `IMPORT_SPECIFIER` above captures only the specifier, which is all resolution
 * needs. A binding check needs the other half — *what* was imported — so this
 * regex captures the clause too. `import "x"` (side effect) has no `from`, and
 * `import("x")` (dynamic) has no whitespace after the keyword, so neither
 * matches.
 *
 * The clause is `[^;]*?` rather than `[\s\S]*?` because the anchor is the bare
 * `import` keyword: a side-effect import immediately followed by a relative
 * `from` import (`Markdown.vue`: `import "katex/dist/katex.min.css";` then
 * `import { api } from "../lib/api";`) would otherwise match once and swallow
 * both statements, reporting the side-effect statement's text as the clause. A
 * real import clause never contains `;`, so excluding it keeps the two apart.
 */
const IMPORT_CLAUSE = /(^|\n)[ \t]*import\s+([^;]*?)\s+from\s*(["'])([^"']+)\3/g;

/** Extensions whose module surface this file can read. */
const BINDING_EXTENSIONS = [".ts", ".vue"];

/**
 * Everything a module exports, and whether it has a default export.
 *
 * Value and type names are kept apart because a `.vue` file's `<script setup>`
 * may declare `export type` and nothing else — the SFC compiler rejects any
 * other export kind there (its check is `node.exportKind !== "type"`). Reading a
 * `<script setup>` block as an ordinary module would therefore both invent value
 * exports that cannot exist and miss the type exports that can.
 */
function exportsOf(file) {
  const source = readFileSync(file, "utf8");
  const values = new Set();
  const types = new Set();
  let hasDefault = false;
  let hasStar = false;

  /** `export type X`, `export interface X` and `export type { X }`. */
  const collectTypes = (code) => {
    for (const match of code.matchAll(
      /(?:^|\n)\s*export\s+(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/g,
    )) {
      types.add(match[1]);
    }
    for (const match of code.matchAll(/(?:^|\n)\s*export\s+type\s*\{([^}]*)\}/g)) {
      for (const part of match[1].split(",")) {
        const name = part.trim().match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
        if (name) types.add(name[2] ?? name[1]);
      }
    }
  };

  /** The full export surface of an ordinary module, or of a plain `<script>`. */
  const collectModule = (code) => {
    collectTypes(code);
    for (const match of code.matchAll(
      /(?:^|\n)\s*export\s+(default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g,
    )) {
      if (match[1]) hasDefault = true;
      values.add(match[2]);
    }
    for (const match of code.matchAll(
      /(?:^|\n)\s*export\s+(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    )) {
      // An `enum` is a value as well as a type; counting it as both is safe.
      values.add(match[1]);
    }
    if (/(?:^|\n)\s*export\s+default\b/.test(code)) hasDefault = true;
    for (const match of code.matchAll(/(?:^|\n)\s*export\s+(type\s+)?\{([^}]*)\}/g)) {
      const listIsTypeOnly = Boolean(match[1]);
      for (const part of match[2].split(",")) {
        const entry = part.trim();
        if (!entry) continue;
        const inlineType = /^type\s+/.test(entry);
        const body = entry.replace(/^type\s+/, "");
        const as = body.match(/^([\w$]+)\s+as\s+([\w$]+)$/);
        const name = as ? as[2] : body;
        if (!/^[\w$]+$/.test(name)) continue;
        if (name === "default") hasDefault = true;
        else if (listIsTypeOnly || inlineType) types.add(name);
        else values.add(name);
      }
    }
    if (/(?:^|\n)\s*export\s+\*/.test(code)) hasStar = true;
  };

  if (file.endsWith(".vue")) {
    const hasTemplate = /<template[\s>]/.test(source);
    let hasSetup = false;
    for (const block of source.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/\bsetup\b/.test(block[1])) {
        hasSetup = true;
        collectTypes(block[2]);
      } else {
        collectModule(block[2]);
      }
    }
    // A `<template>` or a `<script setup>` is what makes the SFC compiler emit
    // `_sfc_main`, i.e. the component itself as the module's default export.
    if (hasSetup || hasTemplate) hasDefault = true;
  } else {
    collectModule(source);
  }

  return { values, types, hasDefault, hasStar };
}

test("every import names a binding its module actually exports", () => {
  // Resolution is not existence. The test above proves a specifier points at a
  // file; it says nothing about whether that file exports what was imported.
  //
  // The Vue port shipped exactly that bug. `components/ChatTranscript` was a
  // `.vue` barrel that re-exported two *foreign* defaults
  // (`export { default as X } from "..."`) and declared no default of its own,
  // while `SessionPane.vue` default-imported it. Every gate passed:
  //
  //   - `electron-vite build` resolves the file and links the bundle, so it
  //     reports nothing;
  //   - `vue-tsc --noEmit` accepts a default import of a `.vue` module that has
  //     none (verified by probe against this tree);
  //   - the resolution test above stops at the filename;
  //   - `vue-class-contract` reads class attributes only.
  //
  // At runtime the dev server inlines the module and appends `const _sfc_main =
  // {}`, so the consumer renders nothing and warns about a missing template.
  // This test is the only thing in the suite that can see it.
  const broken = [];
  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT_CLAUSE)) {
      const specifier = match[4];
      if (!isRelativeSpecifier(specifier)) continue;
      const target = resolveSpecifier(file, specifier);
      // A missing file is the resolution test's finding, not this one's.
      if (target === null) continue;
      if (!BINDING_EXTENSIONS.includes(target.slice(target.lastIndexOf(".")))) continue;

      const clause = match[2].trim().replace(/^type\s+/, "");
      // `import * as ns from "..."` binds a namespace object, never a name.
      if (/^\*\s+as\s/.test(clause)) continue;
      const exported = exportsOf(target);
      const line = source.slice(0, match.index).split("\n").length;
      const where = `${rendererPath(file)}:${line} -> ${rendererPath(target)}`;

      const beforeBraces = clause.split("{")[0].replace(/,\s*$/, "").trim();
      if (beforeBraces && !exported.hasDefault) {
        broken.push(`${where}: default import, but it has no default export`);
      }
      const braced = clause.match(/\{([\s\S]*?)\}/);
      if (!braced) continue;
      for (const part of braced[1].split(",")) {
        const entry = part.trim();
        if (!entry) continue;
        const name = entry
          .replace(/^type\s+/, "")
          .match(/^([\w$]+)(?:\s+as\s+[\w$]+)?$/)?.[1];
        if (!name) continue;
        if (exported.hasStar) continue;
        if (exported.values.has(name) || exported.types.has(name)) continue;
        broken.push(`${where}: imports \`${name}\`, which it does not export`);
      }
    }
  }
  assert.deepEqual(
    broken,
    [],
    "the renderer imports bindings that do not exist, so the surface renders " +
      `nothing: ${broken.join(", ")}. A .vue module's default export comes from ` +
      "its `<template>` or `<script setup>` block; a barrel that only " +
      "re-exports foreign names has none.",
  );
});

test("the alias tables still name modules that exist", () => {
  // The alias test above is only as good as these targets: a stale entry would
  // make every specifier through it "resolve" to nothing and be skipped.
  const missing = ALIASES.filter(
    (entry) => !exists(resolve(workspaceRoot, entry.target)),
  ).map((entry) => `${entry.prefix} -> ${entry.target}`);
  assert.deepEqual(
    missing,
    [],
    `alias targets in this test no longer exist: ${missing.join(", ")}. Update ` +
      "ALIASES to match electron.vite.config.ts and tsconfig.json.",
  );
});

test("the shell's whole module graph is reachable from App.vue", () => {
  // Resolution alone does not prove the entry chain is wired: a rename inside
  // the chain would resolve to a different file and still pass the sweep above.
  const entry = join(rendererRoot, "App.vue");
  assert.ok(isFile(entry), "App.vue is missing, so nothing renders");

  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[2];
      const target = isRelativeSpecifier(specifier)
        ? resolveSpecifier(file, specifier)
        : resolveAlias(specifier);
      if (target === null) continue;
      const resolved = isFile(target) ? target : resolveSpecifier(file, target);
      if (resolved !== null) queue.push(resolved);
    }
  }

  for (const required of [
    "features/app/AppShell.vue",
    "features/app/chrome/ErrorBoundary.vue",
    "features/app/useAppShellRuntime.ts",
    "components/Sidebar.vue",
    "components/ChatSurface.vue",
  ]) {
    assert.ok(
      seen.has(join(rendererRoot, required)),
      `${required} is not reachable from App.vue, so the shell cannot render it`,
    );
  }
});

/**
 * Surfaces the shell calls that are not replicated yet.
 *
 * Each one is a placeholder that resolves the shell's import so the frame
 * boots. They are listed rather than derived because the list *is* the placeholder
 * list: deleting an entry means the surface is complete, and the shell's own
 * import would fail if the file vanished.
 *
 * The list is empty: every surface `AppShell.vue` imports is now a real port.
 * It is kept, and the two tests below are kept, because they are the guard that
 * stops the backlog from silently reopening — a new placeholder added without a
 * declaration fails "no placeholder exists that this list does not declare",
 * and a declaration whose file grew a real body fails the first test.
 */
const UNPORTED_PLACEHOLDERS = [];

const PLACEHOLDER_MARKER = "PLACEHOLDER — NOT PORTED YET.";

test("every declared placeholder is still a marker-carrying stub", () => {
  // Both halves matter. The file must exist so the shell's import resolves, and
  // it must still *be* a placeholder: a surface that keeps the marker, or
  // a stub that quietly grows real markup, would leave this list describing a
  // backlog that is no longer true.
  const missing = [];
  const unmarked = [];
  const grown = [];
  for (const path of UNPORTED_PLACEHOLDERS) {
    const file = join(rendererRoot, path);
    if (!isFile(file)) {
      missing.push(path);
      continue;
    }
    const source = readFileSync(file, "utf8");
    if (!source.includes(PLACEHOLDER_MARKER)) unmarked.push(path);
    // The stub body is a bare `<span />`, optionally behind `v-if` (a
    // placeholder that has to honour a prop the shell always passes). Anything
    // richer is a real port that should have left this list.
    const template = source.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? "";
    if (!/^\s*<span(?:\s+v-if="[^"]*")?\s*\/>\s*$/.test(template)) grown.push(path);
  }
  assert.deepEqual(
    missing,
    [],
    `the shell imports these surfaces but no file answers them: ${missing.join(", ")}`,
  );
  assert.deepEqual(
    unmarked,
    [],
    `declared placeholders lost their "${PLACEHOLDER_MARKER}" marker: ${unmarked.join(", ")}. ` +
      "If the surface was ported, delete the entry from UNPORTED_PLACEHOLDERS.",
  );
  assert.deepEqual(
    grown,
    [],
    `declared placeholders grew a real body: ${grown.join(", ")}. If the surface ` +
      "was ported, delete the entry from UNPORTED_PLACEHOLDERS.",
  );
});

test("no placeholder exists that this list does not declare", () => {
  // The reverse direction: a placeholder added without being declared would
  // quietly grow the set of surfaces the app boots without.
  const undeclared = sourceFiles
    .filter((file) => readFileSync(file, "utf8").includes(PLACEHOLDER_MARKER))
    .map(rendererPath)
    .filter((path) => !UNPORTED_PLACEHOLDERS.includes(path))
    .sort();
  assert.deepEqual(
    undeclared,
    [],
    `undeclared placeholder components: ${undeclared.join(", ")}. Add them to ` +
      "UNPORTED_PLACEHOLDERS so the backlog stays honest.",
  );
});

test("no component reads a kebab-case declared prop by its kebab key", () => {
  // Vue camelizes every key in a declared `props` object (`data-source-start`
  // becomes `dataSourceStart`), so `props["data-source-start"]` is always
  // `undefined` while `props.dataSourceStart` resolves. The Markdown port
  // shipped with exactly that bug: every `data-source-*` anchor was dropped,
  // which silently broke transcript search highlighting, and no test noticed
  // because the anchors are only observable in rendered DOM.
  //
  // Only `.vue` files are scanned: a plain object literal in a `.ts` helper is
  // free to use a kebab key, and `sourcePositionProps` legitimately does.
  const offenders = [];
  for (const file of sourceFiles.filter((path) => path.endsWith(".vue"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/props\[\s*"([a-z][a-z0-9]*-[a-z0-9-]*)"\s*\]/g)) {
      offenders.push(`${rendererPath(file)}: props["${match[1]}"]`);
    }
  }
  assert.deepEqual(
    offenders.sort(),
    [],
    `these reads can never resolve because Vue camelizes declared prop keys: ${offenders.join(", ")}. ` +
      "Use the camelCase name, or read the value from `attrs`.",
  );
});
