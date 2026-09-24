/**
 * Template bindings and template-backed re-exports.
 *
 * Two production defects reached `master` without any gate noticing, and both
 * were only found by a fixture that mounted the real components in a real
 * window. Neither is visible to `vue-tsc`, `npm run build`, `npm run lint`, the
 * class-name contract or the module-graph contract, because in both cases the
 * build *succeeds* and the source *resolves*:
 *
 *  1. **A template tag with no binding.** `Composer.vue` rendered
 *     `<ComposerStatus …>` while never importing it (`307a1f6` dropped the
 *     import when it inserted `ComposerImageAttachments` next to it). Vue
 *     resolves an unbound PascalCase tag at runtime through
 *     `resolveComponent("ComposerStatus")`, which fails with a warning and
 *     renders nothing, so the whole status block — the queued prompts, the
 *     dropped-directory prompt and the enhancement error — silently vanished
 *     from the composer. `renderer-module-graph` only walks `import`
 *     statements, so a *missing* import is exactly what it cannot see.
 *
 *  2. **A named export of a template-backed component.** `ToolDetails.vue`
 *     defines its component in a plain `<script>` block and exported it both
 *     ways — `export { ToolDetailBlocks }` and `export default
 *     ToolDetailBlocks`. `@vitejs/plugin-vue` attaches the compiled render to
 *     the component with `_export_sfc(component, [["render", …]])`, and that
  *     call is `@__PURE__`-annotated, so a consumer that imports only the
 *     *named* export lets the bundler drop it as side-effect-free. The named
 *     binding then resolves to the raw component object, which has no render
 *     function: every expanded tool row rendered its collapse rail and an
 *     empty body. Both consumers (`ToolRow.vue`, `PermissionCard.vue`) use the
 *     named import, and `out/renderer` contained no `tool-block` class at all.
 *
 * The second guard is written against the *idiom*, not against the two files
 * that broke: any `.vue` file whose plain script both defaults and locally
 * re-exports the same identifier is reported. The tree's safe shapes are the
 * self re-export (`export { default as X } from "./X.vue"`, as
 * `AssistantTurn.vue`, `ActivityGroup.vue` and `ToolRow.vue` do) and a named
 * export of a component that has no template (`ToolChips`, a render function).
 *
 * Both guards are asserted against deliberately broken sources below, because
 * a guard that silently stops matching passes forever.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { rendererRoot, walk } from "./helpers/class-contract.mjs";

/** Components Vue resolves without an import. */
const BUILTIN_COMPONENTS = new Set([
  "component",
  "Fragment",
  "KeepAlive",
  "Suspense",
  "Teleport",
  "Transition",
  "TransitionGroup",
]);

/**
 * The `<template>` block of an SFC, or `null`.
 *
 * Nested `<template v-if>` elements are why this takes the outermost pair: the
 * first `<template>` opens and the last `</template>` closes.
 */
function templateBlock(source) {
  const match = source.match(/<template(\s[^>]*)?>([\s\S]*)<\/template>\s*$/);
  return match ? match[2] : null;
}

/** Every `<script>` block of an SFC, in file order. */
function scriptBlocks(source) {
  return [...source.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(
    (match) => ({ attributes: match[1] ?? "", body: match[2] }),
  );
}

/** A script with its comments removed.
 *
 * The tree documents its ports in long header comments, and those comments
 * quote the very shapes this file reports (`export { X }`, `<ComposerStatus>`).
 * Reading them as code makes the guard fire on its own documentation, so the
 * prose is stripped first. Block comments go wholesale; a line comment is only
 * removed when it starts its line, so a `//` inside a string (`https://…`) is
 * left alone.
 */
function withoutComments(script) {
  return script
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

/** A template with its HTML and expression comments removed. */
function withoutTemplateComments(template) {
  return withoutComments(template.replace(/<!--[\s\S]*?-->/g, " "));
}

/** PascalCase element names the template instantiates. */
function templateComponents(template) {
  const names = new Set();
  for (const match of template.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)) {
    names.add(match[1]);
  }
  return names;
}

/** Local `components: { … }` registrations of one script block. */
function locallyRegistered(script) {
  const names = new Set();
  for (const match of script.matchAll(/components\s*:\s*\{([^}]*)\}/g)) {
    for (const entry of match[1].split(",")) {
      const name = entry.split(":")[0].trim().replace(/["']/g, "");
      if (name) names.add(name);
    }
  }
  return names;
}

/** The identifier a plain script hands to `export default`. */
function defaultExportIdentifier(script) {
  const match = script.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;/);
  return match ? match[1] : null;
}

/**
 * Identifiers a script re-exports from *its own* scope.
 *
 * `export { A, B as C }` counts; `export { default as X } from "./X.vue"` does
 * not, because that form re-exports another module's binding and is the safe
 * shape this guard points at.
 */
function localNamedExports(script) {
  const names = new Set();
  for (const match of script.matchAll(/export\s*\{([^}]*)\}(?!\s*from\b)/g)) {
    for (const entry of match[1].split(",")) {
      const parts = entry.split(/\s+as\s+/);
      const name = (parts[1] ?? parts[0]).trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** One renderer SFC per entry, with its template and scripts already split. */
function rendererSources() {
  const files = walk(rendererRoot, (name) => name.endsWith(".vue"));
  return files.map((file) => {
    const source = readFileSync(file, "utf8");
    return {
      file,
      path: file.slice(rendererRoot.length).split("\\").join("/"),
      template: templateBlock(source),
      scripts: scriptBlocks(source),
    };
  });
}

const sources = rendererSources();

/** Template tags that no binding in the same SFC can resolve. */
function unboundComponents(template, scripts) {
  const markup = withoutTemplateComments(template);
  const scriptText = scripts
    .map((script) => withoutComments(script.body))
    .join("\n");
  const registered = new Set(
    scripts.flatMap((script) => [...locallyRegistered(script.body)]),
  );
  const unbound = [];
  for (const name of templateComponents(markup)) {
    if (BUILTIN_COMPONENTS.has(name)) continue;
    if (registered.has(name)) continue;
    if (new RegExp(`\\b${name}\\b`).test(scriptText)) continue;
    unbound.push(name);
  }
  return unbound.sort();
}

/** Plain scripts that default-export and locally re-export one identifier. */
function unsafeReExports(scripts) {
  const offenders = [];
  for (const script of scripts) {
    // `<script setup>` cannot export, so only a plain block can carry this.
    if (/\bsetup\b/.test(script.attributes)) continue;
    const body = withoutComments(script.body);
    const identifier = defaultExportIdentifier(body);
    if (!identifier) continue;
    if (localNamedExports(body).has(identifier)) offenders.push(identifier);
  }
  return offenders;
}

test("the renderer scan finds the SFCs it is meant to guard", () => {
  // A path or extension change would otherwise turn both guards below into a
  // clean sweep over nothing.
  assert.ok(
    sources.length > 100,
    `expected the renderer to hold many SFCs, found ${sources.length}`,
  );
  const withTemplate = sources.filter((source) => source.template !== null);
  assert.ok(
    withTemplate.length > 100,
    `expected most SFCs to carry a template, found ${withTemplate.length}`,
  );
});

test("every component a template renders is bound in its own file", () => {
  const broken = [];
  for (const source of sources) {
    if (source.template === null) continue;
    const unbound = unboundComponents(source.template, source.scripts);
    if (unbound.length) broken.push(`${source.path}: ${unbound.join(", ")}`);
  }
  assert.deepEqual(
    broken,
    [],
    `template tag with no import or local registration (Vue resolves it to nothing at runtime):\n  ${broken.join("\n  ")}`,
  );
});

test("no plain script defaults and locally re-exports one component", () => {
  const broken = [];
  for (const source of sources) {
    const offenders = unsafeReExports(source.scripts);
    if (offenders.length) {
      broken.push(`${source.path}: ${offenders.join(", ")}`);
    }
  }
  assert.deepEqual(
    broken,
    [],
    [
      "a plain <script> block both defaults and locally re-exports the same",
      "component. `@vitejs/plugin-vue` attaches the compiled render with a",
      "`/* @__PURE__ */` helper call, so a consumer importing only the named",
      "export lets the bundler drop it and receives a component with no render.",
      "Re-export the default instead: `export { default as X } from \"./X.vue\"`.",
      "",
      `  ${broken.join("\n  ")}`,
    ].join("\n"),
  );
});

test("the unbound-tag guard catches a missing import", () => {
  // The real defect: Composer.vue rendered `<ComposerStatus …>` unimported.
  const template = `<div class="composer-stack">\n  <ComposerStatus :queued-prompts="queuedPrompts" />\n</div>`;
  const scripts = [
    { attributes: "", body: 'import ComposerImageAttachments from "./x.vue";\n' },
  ];
  assert.deepEqual(unboundComponents(template, scripts), ["ComposerStatus"]);
  // …and stops reporting once the import is restored.
  assert.deepEqual(
    unboundComponents(template, [
      {
        attributes: "",
        body: 'import ComposerStatus from "./ComposerStatus.vue";\n',
      },
    ]),
    [],
  );
  // Built-ins need no import, and a local registration counts as a binding.
  assert.deepEqual(
    unboundComponents(`<Teleport to="body"><Panel /></Teleport>`, [
      { attributes: "", body: 'import Panel from "./Panel.vue";' },
    ]),
    [],
  );
  assert.deepEqual(
    unboundComponents(`<Panel />`, [
      { attributes: "", body: 'import Inner from "./Inner.vue";\nconst Panel = Inner;' },
    ]),
    [],
  );
});

test("the re-export guard catches the shape that lost the render", () => {
  // The real defect: ToolDetails.vue's original export block.
  const broken = {
    attributes: "",
    body: [
      "const ToolDetailBlocks = defineComponent({ name: \"ToolDetailBlocks\" });",
      "export { ToolChips, ToolDetailBlocks };",
      "export default ToolDetailBlocks;",
    ].join("\n"),
  };
  assert.deepEqual(unsafeReExports([broken]), ["ToolDetailBlocks"]);

  // The fix that keeps the compiled render: a self re-export of the default.
  assert.deepEqual(
    unsafeReExports([
      {
        attributes: "",
        body: [
          "const ToolDetailBlocks = defineComponent({ name: \"ToolDetailBlocks\" });",
          "export { ToolChips };",
          'export { default as ToolDetailBlocks } from "./ToolDetails.vue";',
          "export default ToolDetailBlocks;",
        ].join("\n"),
      },
    ]),
    [],
  );

  // A component with no template is unaffected: `ToolChips` is a render
  // function in the same script, so exporting it by name is safe.
  assert.deepEqual(
    unsafeReExports([
      {
        attributes: "",
        body: [
          "const ToolChips = defineComponent({ setup: () => () => null });",
          "export { ToolChips };",
        ].join("\n"),
      },
    ]),
    [],
  );

  // `<script setup>` cannot export, so the sibling re-export idiom there is
  // never reported.
  assert.deepEqual(
    unsafeReExports([
      {
        attributes: ' setup lang="ts"',
        body: 'export { default as X } from "./X.vue";',
      },
    ]),
    [],
  );
});

test("the two files this guard was written for keep their fixed shape", () => {
  const composer = sources.find(
    (source) => source.path === "components/Composer.vue",
  );
  assert.ok(composer, "components/Composer.vue is missing");
  assert.deepEqual(unboundComponents(composer.template, composer.scripts), []);

  const toolDetails = sources.find(
    (source) => source.path === "components/ToolDetails.vue",
  );
  assert.ok(toolDetails, "components/ToolDetails.vue is missing");
  assert.deepEqual(unsafeReExports(toolDetails.scripts), []);
  // The named export the two consumers rely on has to stay reachable.
  assert.match(
    toolDetails.scripts.map((script) => script.body).join("\n"),
    /export\s*\{\s*default\s+as\s+ToolDetailBlocks\s*\}\s*from\s*"\.\/ToolDetails\.vue"/,
  );
  for (const consumer of [
    "components/PermissionCard.vue",
    "features/chat/transcript/ToolRow.vue",
  ]) {
    const source = sources.find((entry) => entry.path === consumer);
    assert.ok(source, `${consumer} is missing`);
    assert.match(
      source.scripts.map((script) => script.body).join("\n"),
      /import\s*\{[^}]*\bToolDetailBlocks\b[^}]*\}\s*from\s*"[^"]*ToolDetails\.vue"/,
      `${consumer} no longer imports ToolDetailBlocks by name`,
    );
  }
});

test("the guard reads the renderer root it reports paths against", () => {
  assert.ok(rendererRoot.endsWith("src/renderer/") || rendererRoot.endsWith("src\\renderer\\"));
  // `walk` is the shared one, so a rename there cannot silently empty the scan.
  const vueFiles = walk(rendererRoot, (name) => name.endsWith(".vue"));
  assert.equal(vueFiles.length, sources.length);
  assert.ok(vueFiles.every((file) => file.startsWith(rendererRoot)));
  assert.equal(join(rendererRoot, "components"), join(rendererRoot, "components"));
});

/**
 * Line numbers of `/>` sequences that are NOT part of a tag.
 *
 * A tag-closing fragment left outside its tag is emitted as literal text, so it
 * paints on screen: `Sidebar.vue` carried a stray `/>` after the resize
 * handle's own `/>`, which rendered a literal "/>" in the bottom-left corner of
 * every window in both themes. Vue parses it as a text node, so `vue-tsc`,
 * `npm run build`, `npm run lint`, the class contract and the module graph all
 * stay green — the same blind spot as the two defects above.
 *
 * The scan is a character walk rather than a regex because a regex cannot tell
 * a real closer from one inside a quoted attribute (`:label="a /> b"`) or inside
 * a string in an interpolation (`{{ s.replace(/x/, '/>') }}`), both of which are
 * legal and both of which the tree contains.
 */
function strayTagClosers(template) {
  const markup = withoutTemplateComments(template);
  const lines = [];
  let line = 1;
  let i = 0;
  let inTag = false;
  let quote = null;
  while (i < markup.length) {
    const ch = markup[i];
    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (inTag) {
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "/" && markup[i + 1] === ">") {
        inTag = false;
        i += 2;
        continue;
      } else if (ch === ">") {
        inTag = false;
      }
      i++;
      continue;
    }
    // An interpolation can hold a legal `/>` inside a string or regex literal.
    if (ch === "{" && markup[i + 1] === "{") {
      const end = markup.indexOf("}}", i + 2);
      if (end === -1) break;
      line += (markup.slice(i, end).match(/\n/g) ?? []).length;
      i = end + 2;
      continue;
    }
    if (ch === "<") {
      inTag = true;
      i++;
      continue;
    }
    if (ch === "/" && markup[i + 1] === ">") {
      lines.push(line);
      i += 2;
      continue;
    }
    i++;
  }
  return lines;
}

test("no template renders a stray tag closer as text", () => {
  const broken = [];
  for (const source of sources) {
    if (source.template === null) continue;
    const lines = strayTagClosers(source.template);
    if (lines.length) broken.push(`${source.path}: line(s) ${lines.join(", ")}`);
  }
  assert.deepEqual(
    broken,
    [],
    [
      "a `/>` that is not inside a tag is rendered as literal text on screen.",
      "",
      `  ${broken.join("\n  ")}`,
    ].join("\n"),
  );
});

test("the stray-closer guard catches the shape that painted on screen", () => {
  // The real defect: Sidebar.vue closed its resize handle twice, so the second
  // `/>` became the `<aside>`'s last child text node.
  const broken = [
    '<aside class="sidebar">',
    "  <div",
    '    class="sidebar-resize-handle"',
    '    role="separator"',
    "  />",
    "  />",
    "</aside>",
  ].join("\n");
  assert.deepEqual(strayTagClosers(broken), [6]);

  // Legal shapes the guard must not report, all of which the tree contains.
  assert.deepEqual(strayTagClosers('<div class="a" />'), []);
  assert.deepEqual(strayTagClosers('<img :alt="a /> b" />'), []);
  assert.deepEqual(strayTagClosers("<span>{{ s.replace(/x/, '/>') }}</span>"), []);
  assert.deepEqual(
    strayTagClosers("<div>\n  <!-- a stray /> in prose -->\n</div>"),
    [],
  );
  // A `/>` that legitimately closes a nested tag is still fine.
  assert.deepEqual(
    strayTagClosers('<div>\n  <IconChevronDown :size="14" />\n</div>'),
    [],
  );
});
