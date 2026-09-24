/**
 * Settings ▸ Import page contract.
 *
 * Covers the assertion that guards the Codex scan cap notice (cc0f78db). The
 * four import kinds are four stacked `.vue` panels under
 * `src/renderer/features/settings/`, so only the assertions that survive that
 * shape are carried here — the rest of the file greps constructs
 * (`role="tablist"`, `hidden={kind !== entry.id}`) that have no equivalent in
 * the Vue panels.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const settingsRoot = fileURLToPath(
  new URL("../src/renderer/features/settings/", import.meta.url),
);

const read = (name) => readFileSync(join(settingsRoot, name), "utf8");

const page = [
  read("ImportSection.vue"),
  read("SessionImportPanel.vue"),
  read("ModelConfigImportPanel.vue"),
  read("SkillsScanImportPanel.vue"),
  read("McpScanImportPanel.vue"),
].join("\n");

test("every kind keeps its own scan and its state across a tab switch", () => {
  for (const call of [
    "scanImportSessions",
    "scanImportModelConfigs",
    "scanExternalSkills",
    "scanExternalMcp",
  ]) {
    assert.match(page, new RegExp(`api\\.${call}\\(`), `${call} missing`);
  }
  // No kind may start another kind's scan.
  assert.match(page, /api\.scanImportSessions\(\)/);
  assert.match(page, /settings\.importCodexCapped/);
  assert.match(page, /api\.scanExternalMcp\(\)/);
});
