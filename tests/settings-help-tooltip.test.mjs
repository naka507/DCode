/**
 * Settings help-icon contract.
 *
 * Covers the help-icon contract (122 lines, added by `b8daa88a` "reach a row's
 * explanation from a help icon").
 *
 * A settings page is a list of decisions. Explanatory prose used to sit in a
 * permanent second line under every title, which buried the decisions it was
 * explaining; it now lives behind a question mark and shows up on hover or
 * focus (D601). The assertions read the SFCs and the composed stylesheet, so
 * every case stands on its own.
 *
 * The `one settings row renderer owns the layout` case reads
 * `NetworkProxySection.vue`, which the commit rewrote. The shared
 * `SettingsRow` had already been inlined there, so the assertion holds
 * unchanged; it is kept as the regression guard it is.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadStylesSync } from "./helpers/styles.mjs";

const read = (relative) =>
  readFileSync(new URL(`../src/renderer/${relative}`, import.meta.url), "utf8");

const helpIcon = read("components/ui/HelpIcon.vue");
const settingsRow = read("features/settings/primitives/SettingsRow.vue");
const settingsCard = read("features/settings/primitives/SettingsCard.vue");
const settingsPage = read("pages/SettingsPage.vue");
const sessionImport = read("features/settings/SessionImportPanel.vue");
const skillsImport = read("features/settings/SkillsScanImportPanel.vue");
const networkProxy = read("components/settings/NetworkProxySection.vue");
const styles = loadStylesSync();

/** One rule body out of the composed stylesheet, by exact selector. */
function cssRule(selector) {
  const start = styles.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing CSS rule ${selector}`);
  return styles.slice(start, styles.indexOf("}", start));
}

test("a settings row explains itself from a help icon, not a second line", () => {
  // The copy travels as a string, because that is what a tooltip can carry.
  assert.match(
    settingsRow,
    /\/\*\* Explanatory copy, revealed on demand from the help icon\. \*\/\n {2}description\?: string;/,
  );
  assert.match(settingsRow, /<HelpIcon v-if="description" :label="description" \/>/);
  // A card heading follows the same rule as a row.
  assert.match(settingsCard, /description\?: string/);
  // The retired always-on line must not come back through the renderers.
  assert.doesNotMatch(settingsRow, /settings-row-desc/);
  // The heading's mark is a sibling, not a child: a nested button joins the
  // heading's accessible name, and a screen reader's heading list would then
  // read out the explanation instead of the title.
  assert.match(settingsCard, /<div v-if="title" class="settings-card-heading-help">/);
  assert.match(settingsCard, /<h3 class="settings-card-heading">\{\{ title \}\}<\/h3>/);
});

test("the help icon is a focusable button whose name is the sentence", () => {
  assert.match(helpIcon, /<TooltipButton/);
  assert.match(helpIcon, /:class="\['ui-help-icon', className\]"/);
  assert.match(helpIcon, /:label="label"/);
  assert.match(helpIcon, /tooltip-class-name="ui-tooltip-help"/);
  assert.match(helpIcon, /:aria-label="label"/);
  assert.match(helpIcon, /<IconHelp :size="13" \/>/);
});

test("the help tooltip wraps instead of running off its anchor", () => {
  const tooltip = cssRule(".ui-tooltip-help");
  assert.match(tooltip, /white-space:\s*normal/);
  assert.match(tooltip, /overflow-wrap:\s*anywhere/);

  const icon = cssRule(".ui-help-icon");
  assert.match(icon, /cursor:\s*help/);
  assert.match(icon, /color:\s*var\(--ds-text-muted\)/);
  // Hover and focus share one selector group, so the rule starts at the
  // first of them rather than at a selector of its own.
  const hover = styles.slice(styles.indexOf(".ui-help-icon:hover"));
  assert.ok(hover.length > 0, "missing the .ui-help-icon hover state");
  assert.match(hover.slice(0, hover.indexOf("}")), /color:\s*var\(--ds-text-secondary\)/);
});

test("the row explanations survive the move into the tooltip", () => {
  for (const key of [
    "settings.permissionModeDesc",
    "settings.modeDesc",
    "settings.enterToSendDesc",
  ]) {
    assert.match(
      settingsPage,
      new RegExp(`:description="t\\('${key.replace(/\./g, "\\.")}'\\)"`),
      `${key} should still be the row's explanation`,
    );
  }
  assert.match(
    settingsRow,
    /<HelpIcon v-if="description" :label="description" \/>/,
  );
  // The row's description is a bound translation; the settings rows are split
  // into SFCs under the primitives folder.
  const thresholdRow = readFileSync(
    new URL(
      "../src/renderer/features/settings/primitives/LargePasteThresholdRow.vue",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    thresholdRow,
    /:description="t\('settings\.largePasteThresholdDesc'\)"/,
  );
  // The default-model row shows a live value, so it stays visible rather than
  // moving behind the mark.
  const modelConfig = read(
    "components/settings/ModelConfigPage.vue",
  );
  assert.match(modelConfig, /class="settings-row-detail model-default-value"/);
  assert.doesNotMatch(modelConfig, /settings-row-desc/);
});

test("one settings row renderer owns the layout", () => {
  // The proxy section used to carry its own copy of the row skeleton, which
  // would have kept the retired second line alive.
  assert.doesNotMatch(networkProxy, /function SettingsRow/);
  assert.match(
    networkProxy,
    /import SettingsRow from "\.\.\/\.\.\/features\/settings\/primitives\/SettingsRow\.vue";/,
  );
});

test("an import hint is reachable from the control it explains", () => {
  // The standalone hint line is gone; the toolbar and its option carry it.
  assert.doesNotMatch(sessionImport, /class="import-hint"/);
  assert.match(
    sessionImport,
    /:label="t\('settings\.importCodexCapped', \{ limit: codexCap \}\)"/,
  );
  assert.doesNotMatch(styles, /\.import-hint\s*\{/);
  // A hint rides beside the controls it explains, so the toolbar must still
  // render them and the mark must sit between the picker and the action: a
  // half-migrated prop list silently dropped the grouping picker once
  // already, and no source-level assertion caught it. The same ordering is
  // asserted here (`{options}\n  {hint ? <HelpIcon`).
  assert.match(
    sessionImport,
    /<div class="import-toolbar-actions">[\s\S]*?<label class="import-group-by">[\s\S]*?<\/label>\s*<HelpIcon[\s\S]*?<Button\s+variant="primary"/,
  );
  // The skills scan keeps its mode picker and moves the sentence onto the row.
  assert.match(skillsImport, /<div class="import-toolbar">/);
  assert.match(
    skillsImport,
    /:description="t\('settings\.importAgentScanModeHint'\)"/,
  );
});
