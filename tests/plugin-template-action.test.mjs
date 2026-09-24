import { readMainSourceSync } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStylesSync } from "./helpers/styles.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, "..");
const repoRoot = desktopRoot;

const mainSrc = readMainSourceSync();
const apiSrc = readFileSync(join(desktopRoot, "src/renderer/lib/api.ts"), "utf8");
const stylesSrc = loadStylesSync();
const protocolSrc = readFileSync(
  join(repoRoot, "src/shared/protocol.ts"),
  "utf8",
);
const templatesSrc = readFileSync(
  join(repoRoot, "src/plugin/devkit/templates.ts"),
  "utf8",
);
const enSrc = readFileSync(
  join(repoRoot, "src/i18n/locales/en/index.ts"),
  "utf8",
);
const zhSrc = readFileSync(
  join(repoRoot, "src/i18n/locales/zh-CN/index.ts"),
  "utf8",
);

/** Template ids in declaration order, read from a `[...] as const` literal. */
function templateIds(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} missing`);
  const literal = source.slice(start, source.indexOf("] as const", start));
  return [...literal.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
}

test("the template channel travels the same path as loadDev", () => {
  assert.match(
    protocolSrc,
    /pluginCreateFromTemplate: "dcode\/plugin\/createFromTemplate"/,
  );
  // IPC_WHITELIST is derived from the table, so the preload gate needs no edit.
  assert.match(protocolSrc, /IPC_WHITELIST = new Set<string>\(\[\s*\.\.\.Object\.values\(IPC\.invoke\)/);
  assert.match(
    apiSrc,
    /createPluginFromTemplate:[\s\S]*IPC\.invoke\.pluginCreateFromTemplate, \{ template \}/,
  );
});

test("main validates the template and asks before loading what it scaffolds", () => {
  const handler = mainSrc.slice(
    mainSrc.indexOf("IPC.invoke.pluginCreateFromTemplate"),
    mainSrc.indexOf("IPC.invoke.pluginInstallFromPath"),
  );
  // The renderer picks a label; only the devkit decides what a template is.
  assert.match(handler, /isTemplateName\(template\)/);
  assert.match(handler, /properties: \["openDirectory", "createDirectory"\]/);
  assert.match(handler, /return \{ canceled: true \}/);
  // Scaffolding writes files and nothing else: registering the plugin is the
  // reviewed load, the same one a hand-picked folder goes through.
  assert.match(handler, /const created = await scaffold\(\{ dir, template \}\)/);
  assert.match(handler, /review: reviewFor\(dir, "load"\)/);
  assert.doesNotMatch(handler, /plugins\.loadDev"/);
  assert.doesNotMatch(handler, /loadFromPath/);
  assert.doesNotMatch(handler, /watchDevPlugin/);
});

test("the renderer template list mirrors the devkit catalogue", () => {
  const devkit = templateIds(templatesSrc, "export const TEMPLATE_NAMES = [");
  // Every id needs a label and a description in both locales.
  for (const id of devkit) {
    for (const [locale, source] of [
      ["en", enSrc],
      ["zh-CN", zhSrc],
    ]) {
      assert.ok(
        source.includes(`"${id}":`),
        `${locale} must name and describe the ${id} template`,
      );
    }
  }
});

test("the template action is reachable from the menu and the empty state", () => {
  for (const key of [
    "newFromTemplate",
    "newFromTemplateTitle",
    "newFromTemplateCreate",
    "newFromTemplateCreating",
    "newFromTemplateDone",
    "newFromTemplateOpened",
  ]) {
    assert.ok(enSrc.includes(`${key}:`), `en must define plugins.${key}`);
    assert.ok(zhSrc.includes(`${key}:`), `zh-CN must define plugins.${key}`);
  }
});

test("the template picker styles use design tokens", () => {
  assert.match(stylesSrc, /\.plugins-template\.active\s*\{[\s\S]*?color-mix\(in oklab/);
  assert.match(stylesSrc, /\.plugins-template-name\s*\{[\s\S]*?--ds-text-primary/);
  assert.match(stylesSrc, /\.plugins-template-body\s*\{[\s\S]*?--ds-text-muted/);
});
