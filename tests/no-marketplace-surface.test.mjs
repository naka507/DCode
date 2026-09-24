import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileTemplate, parse } from "vue/compiler-sfc";

import { loadStylesSync } from "./helpers/styles.mjs";

/**
 * No remote marketplace surface.
 *
 * dcode deliberately ships no plugin marketplace, no skill market, and no MCP
 * registry market. They were removed together because each one put a remote
 * catalog between the user and the install, and the local paths already cover
 * the need:
 *
 *   - MCP: manual add / edit / delete (`AgentMcpPage.vue`, `mcp-control.ts`)
 *   - Skills: manual add plus the "scan other tools" import
 *     (`src/main/importers/agent-skill-scan.ts`)
 *   - Plugins: local install from a path or a package
 *     (`installPluginFromPath` / `installPluginFromPackage`), plus the devkit
 *     extension import
 *   - Plugin lifecycle: enable / disable / uninstall / scope / permissions
 *
 * The failure this guards against is the one that produced this change: a
 * market tab, its IPC channel, its API method, its i18n keys and its CSS all
 * have to be deleted together, and any one of them left behind is enough to
 * grow the feature back. The removals are easy to redo and hard to notice, so
 * each surface is asserted absent by name.
 *
 * `AGENTS.md` § 3 "No remote marketplace or catalog surface" is the policy this
 * test enforces.
 */

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const read = (relPath) => readFileSync(join(repoRoot, relPath), "utf8");

/**
 * Renderer, main, shared and preload sources. The Rust host is a sibling
 * checkout and is out of scope here: `dcore` still owns `PLUGIN_MARKET_*` codes
 * and the `source: "marketplace"` value its own tests assert on.
 */
const sourceFiles = [
  ...walk(join(repoRoot, "src", "renderer")),
  ...walk(join(repoRoot, "src", "main")),
  ...walk(join(repoRoot, "src", "shared")),
  ...walk(join(repoRoot, "src", "preload")),
].filter((file) => /\.(ts|vue|css)$/.test(file));

const relativeOf = (file) => relative(repoRoot, file).replaceAll("\\", "/");

/** Files that must not exist at all. */
const DELETED_PATHS = [
  // Main process: the market catalogs, their fetch client, and the market IPC.
  "src/main/ipc/market-ipc.ts",
  "src/main/skill-market-catalog.ts",
  "src/main/skill-market-scan.ts",
  "src/main/mcp-registry-catalog.ts",
  "src/main/public-https-fetch.ts",
  // Shared contracts for the three catalogs.
  "src/shared/types/marketplace.ts",
  "src/shared/mcp-registry.ts",
  "src/shared/mcp-catalog.ts",
  "src/shared/mcp-catalog-builtin.ts",
  "src/shared/skill-catalog.ts",
  "src/shared/skill-catalog-builtin.ts",
  // Renderer surfaces.
  "src/renderer/features/plugins/MarketplacePanel.vue",
  "src/renderer/features/plugins/PluginDetailSheet.vue",
  "src/renderer/features/plugins/install-progress.ts",
  "src/renderer/components/settings/SkillMarketPanel.vue",
  "src/renderer/components/settings/McpMarketPanel.vue",
  "src/renderer/components/settings/mcp-market.ts",
  "src/renderer/components/plugins/MarketplaceSourceSettings.vue",
  "src/renderer/components/plugins/PluginInstallDialog.vue",
  "src/renderer/lib/skill-market-failure.ts",
  // E2E drivers and the catalog preflight.
  "scripts/e2e-mcp-market.mjs",
  "scripts/e2e-skill-market.mjs",
  "scripts/check-marketplace-catalog.mjs",
];

/**
 * Tokens that must not appear anywhere in the remaining sources. Each entry is
 * a `[needle, why]` pair; the `why` is the user-visible surface the token would
 * bring back, so a failure reads as a feature regression rather than a grep hit.
 */
const FORBIDDEN_TOKENS = [
  ["marketSearch", "the plugin marketplace search IPC channel and API method"],
  ["marketGetDetail", "the plugin detail sheet's only data source"],
  ["marketInstall", "the marketplace install channel"],
  ["marketCheckUpdates", "the plugin update check"],
  ["marketApplyUpdates", "the plugin auto-update applier"],
  ["marketRefresh", "the marketplace catalog refresh"],
  ["marketCancelInstall", "the marketplace install cancellation"],
  ["pluginSetAutoUpdate", "the per-plugin auto-update toggle"],
  ["setPluginAutoUpdate", "the renderer API method for the auto-update toggle"],
  ["mcpMarketSearch", "the MCP registry market search"],
  ["skillMarketSearch", "the skill market search"],
  ["fetchSkillMarketDocument", "the skill market document fetch"],
  ["McpMarketPanel", "the MCP market panel component"],
  ["SkillMarketPanel", "the skill market panel component"],
  ["MarketplacePanel", "the plugin marketplace grid"],
  ["PluginDetailSheet", "the marketplace plugin detail sheet"],
  ["MarketplaceSourceSettings", "the marketplace source picker"],
  ["PluginInstallDialog", "the marketplace install progress dialog"],
  ["install-progress", "the marketplace install progress model"],
  ["marketPlace", "a marketplace spelling that has no reason to exist"],
  ["marketSource", "the marketplace catalog source setting"],
  ["pluginMarketSource", "the persisted marketplace source setting"],
  ["pluginMarketCustomUrl", "the persisted marketplace custom catalog URL"],
  ["normalizePluginMarketSource", "the marketplace source normalizer"],
  ["updateAvailable", "the plugin update-available flag on a summary"],
  ["PluginUpdateInfo", "the plugin update descriptor type"],
  ["PluginYankNotice", "the marketplace version-withdrawal notice type"],
  ["PluginMarketplaceMeta", "the marketplace provenance metadata type"],
  ["MarketTrust", "the marketplace trust tier type"],
  ["MarketProvenance", "the marketplace provenance type"],
  ["MarketPluginSummary", "the marketplace catalog summary type"],
  ["MarketPluginDetail", "the marketplace catalog detail type"],
  ["MarketSource", "the marketplace catalog source type"],
  ["McpCatalogEntry", "the MCP catalog entry type"],
  ["SkillCatalogEntry", "the skill catalog entry type"],
  ["PluginInstallResult", "the marketplace install result type"],
];

test("the removed marketplace modules stay deleted", () => {
  const stillThere = DELETED_PATHS.filter((relPath) => {
    try {
      return statSync(join(repoRoot, relPath)).isFile();
    } catch {
      return false;
    }
  });
  assert.deepEqual(
    stillThere,
    [],
    "these files were removed with the marketplace features and must not come back",
  );
});

test("no source file names a marketplace surface", () => {
  const hits = [];
  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    for (const [needle, why] of FORBIDDEN_TOKENS) {
      if (source.includes(needle)) hits.push(`${relativeOf(file)}: ${needle} (${why})`);
    }
  }
  assert.deepEqual(
    hits,
    [],
    "a marketplace surface was reintroduced. dcode ships local install paths " +
      "only — see AGENTS.md § 3 'No remote marketplace or catalog surface'.",
  );
});
test("the shared protocol declares no marketplace IPC channel", () => {
  const protocol = read("src/shared/protocol.ts");
  for (const channel of [
    "dcode/market/",
    "dcode/mcp/market/",
    "dcode/skill/market/",
    "dcode/plugin/setAutoUpdate",
  ]) {
    assert.equal(
      protocol.includes(channel),
      false,
      `${channel} is a marketplace IPC channel and must stay removed`,
    );
  }
  // The local paths the removal has to leave working.
  for (const channel of [
    "pluginInstallFromPath",
    "pluginInstallFromPackage",
    "pluginUninstall",
    "pluginEnable",
    "pluginDisable",
  ]) {
    assert.match(protocol, new RegExp(channel), `${channel} must remain an IPC channel`);
  }
});

test("the renderer API exposes no marketplace method", () => {
  const api = read("src/renderer/lib/api.ts");
  for (const method of [
    "marketSearch",
    "marketGetDetail",
    "marketInstall",
    "marketCheckUpdates",
    "marketApplyUpdates",
    "marketRefresh",
    "setPluginAutoUpdate",
  ]) {
    assert.equal(
      api.includes(method),
      false,
      `api.${method} is a marketplace method and must stay removed`,
    );
  }
  // The four user paths that must survive the removal.
  for (const method of [
    "installPluginFromPath",
    "installPluginFromPackage",
    "importPiExtension",
    "loadDevPlugin",
    "listMcpServers",
    "upsertMcpServer",
    "removeMcpServer",
    "listUserSkills",
    "createUserSkill",
    "scanExternalSkills",
    "runExternalSkillsImport",
  ]) {
    assert.match(api, new RegExp(method), `api.${method} must survive the removal`);
  }
});

test("neither locale carries a marketplace string", () => {
  for (const locale of ["en", "zh-CN"]) {
    const source = read(`src/i18n/locales/${locale}/index.ts`);
    for (const key of [
      "tabMarket",
      "browseMarket",
      "refreshMarket",
      "marketSearchPlaceholder",
      "marketRefreshed",
      "marketSource",
      "marketLoading",
      "marketEmpty",
      "marketProvider",
      "marketProviderLocal",
      "marketProviderCustom",
      "marketCustomUrl",
      "marketCustomUrlDesc",
      "marketCustomUrlPlaceholder",
      "mcpMarket",
      "sklm",
      "enableAutoUpdate",
      "disableAutoUpdate",
      "enableAutoUpdateOnInstall",
      "applyAutoUpdates",
      "updatesReady",
    ]) {
      assert.equal(
        new RegExp(`\\b${key}\\b`).test(source),
        false,
        `${locale} still declares the marketplace key "${key}"`,
      );
    }
    // The local import paths keep their strings.
    for (const key of ["importSkillFile", "importSkillDir", "loadDev", "installPackage"]) {
      assert.match(source, new RegExp(key), `${locale} lost the local path key "${key}"`);
    }
  }
});

test("the stylesheet defines no marketplace class", () => {
  const styles = loadStylesSync();
  for (const selector of [
    ".plugins-market-settings",
    ".plugins-card",
    ".plugins-sheet",
    ".plugins-segment",
    ".plugins-alert",
    ".plugins-install-modal",
    ".plugins-version-list",
    ".plugins-provenance",
    ".plugins-readme",
    ".mcpm",
    ".sklm",
  ]) {
    assert.equal(
      new RegExp(`\\${selector}\\s*[,{]`).test(styles),
      false,
      `${selector} is a marketplace rule and must stay removed`,
    );
  }
  // The installed index keeps its rules.
  for (const selector of [
    ".plugins-row",
    ".plugins-group",
    ".plugins-perm-list",
    ".plugins-modal-backdrop",
    ".plugins-toolbar",
  ]) {
    assert.match(styles, new RegExp(`\\${selector}\\s*[,{]`), `${selector} must survive`);
  }
});

test("the removal left no template half-open", () => {
  // Deleting a wrapper element's opening tag but not its closer (or the
  // reverse) is this change's own failure mode, and nothing else caught it:
  // `vue-tsc` accepted a template with a stray `</div>` and so did the suite.
  // Compiling every SFC is what turns that into a named failure.
  const problems = [];
  for (const file of walk(join(repoRoot, "src")).filter((p) => p.endsWith(".vue"))) {
    const rel = relativeOf(file);
    const { descriptor, errors } = parse(readFileSync(file, "utf8"), { filename: rel });
    for (const error of errors) problems.push(`${rel}: ${error.message}`);
    if (!descriptor.template) continue;
    const compiled = compileTemplate({
      source: descriptor.template.content,
      filename: rel,
      id: rel,
    });
    for (const error of compiled.errors) {
      const line = typeof error === "object" && error.loc ? error.loc.start.line : "?";
      problems.push(`${rel}:${line}: ${error.message ?? error}`);
    }
  }
  assert.deepEqual(problems, [], "a component template no longer compiles");
});
