/**
 * Settings ▸ Remote Hosts page contract.
 *
 * Kept at 1:1 case parity. The source under test is this tree's `.vue`
 * single-file component, so the patterns are expressed against Vue template
 * syntax (`:hidden="…"` rather than `hidden={…}`, `:class` object syntax
 * rather than `cx(...)`).
 *
 * Guards the compact inventory + Add (SSH/Pair) layout: no instructional copy,
 * both add modes stay mounted behind `hidden`, and the destination is marked
 * Experimental on the rail and page title.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { loadStylesSync } from "./helpers/styles.mjs";

const page = readFileSync(
  new URL("../src/renderer/components/settings/RemoteHostsPage.vue", import.meta.url),
  "utf8",
);
const settings = readFileSync(
  new URL("../src/renderer/pages/SettingsPage.vue", import.meta.url),
  "utf8",
);
const styles = loadStylesSync();

function cssRule(selector) {
  const from = styles.indexOf(`\n${selector} {`);
  assert.ok(from >= 0, `${selector} rule missing`);
  return styles.slice(from, styles.indexOf("}", from));
}

test("remote hosts is an inventory plus one SSH/Pair add form", () => {
  assert.match(page, /role="tablist"/);
  assert.match(page, /:aria-controls="`remote-host-add-panel-\$\{mode\}`"/);
  assert.match(page, /id="remote-host-add-panel-ssh"|id="remote-host-add-panel-pair"/);
  assert.match(page, /:hidden="addMode !== 'ssh'"/);
  assert.match(page, /:hidden="addMode !== 'pair'"/);
  assert.match(page, /api\.bootstrapRemoteHost\(/);
  assert.match(page, /api\.pairRemoteHost\(/);
  assert.match(page, /api\.listRemoteHosts\(/);
  assert.match(page, /api\.removeRemoteHost\(/);

  assert.match(cssRule(".settings-remote-host-add-panel[hidden]"), /display:\s*none/);
  assert.match(cssRule(".settings-remote-host-card"), /background:\s*var\(--ds-tile\)/);
  assert.match(cssRule(".settings-remote-host-name"), /font-size:\s*var\(--text-md-plus\)/);
});

test("remote hosts omits instructional copy", () => {
  assert.doesNotMatch(page, /role="note"/);
  assert.doesNotMatch(page, /settings-row-desc/);
  assert.doesNotMatch(page, /:hint=/);
  assert.doesNotMatch(page, /settings\.remoteHosts\.(overview|sshBody|pairBody|emptyBody)/);
  assert.doesNotMatch(page, /<SettingsCard/);
});

test("the remote-hosts destination is marked experimental", () => {
  assert.match(settings, /item\.id === 'remoteHosts'/);
  assert.match(settings, /settings\.remoteHosts\.experimental/);
  assert.match(settings, /class="settings-nav-experimental"/);
  assert.match(cssRule(".settings-nav-experimental"), /font-size:\s*var\(--text-2xs\)/);
  assert.doesNotMatch(page, /EXPERIMENTAL_FEATURES/);
  assert.doesNotMatch(page, /experimentalLan/);
  assert.doesNotMatch(page, /experimentalGateway/);
  assert.doesNotMatch(page, /SettingsCard/);
});
