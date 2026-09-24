/**
 * Settings empty-state and extension-rail glyph contract.
 *
 * Covers the two assertions `73ee3beb` ("show empty-state icons and extension
 * rail glyphs") added: the empty state must chip its glyph on a wrapper rather
 * than padding the Lucide SVG, and a plugin-declared settings destination must
 * draw its own icon token instead of the Skills book placeholder.
 *
 * Those assertions were split across two settings/plugins test files, and the
 * first one imports a settings/plugins source-contract helper pair this tree
 * does not carry. The Vue equivalents are one component and one template
 * expression, so the assertions live here together.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadStylesSync } from "./helpers/styles.mjs";

const read = (relative) =>
  readFileSync(new URL(`../src/renderer/${relative}`, import.meta.url), "utf8");

const capabilityEmpty = read("components/settings/CapabilityEmpty.vue");
const settingsPage = read("pages/SettingsPage.vue");
const styles = loadStylesSync();

test("the empty state dresses its own glyph, not the icon in its CTA button", () => {
  // Lucide icons set inline width/height. Padding the SVG itself crushed the
  // stroke into a blank chip, and a descendant `svg` rule also ate the CTA
  // button's icon. Chip the host Icon on a wrapper instead.
  assert.match(capabilityEmpty, /agent-capability-empty-icon/);
  assert.match(styles, /\.agent-capability-empty-icon\s*\{/);
  assert.doesNotMatch(styles, /\.agent-capability-empty svg\s*\{/);
  assert.doesNotMatch(styles, /\.agent-capability-empty > svg\s*\{/);
  // The wrapper is what carries `aria-hidden`, so the glyph inside it does not
  // need to repeat it and a caller's own icon is hidden the same way.
  assert.match(
    capabilityEmpty,
    /<span class="agent-capability-empty-icon" aria-hidden="true">/,
  );
});

test("a scenic settings entry draws its own icon token, not the Skills book", () => {
  // The destination token is the only icon information a plugin may carry
  // (ADR 0104); `pluginViewIcon` resolves it and `IconPalette` is the fallback
  // for a token this build does not know.
  assert.match(settingsPage, /pluginViewIcon\(entry\.icon\)/);
  assert.match(settingsPage, /pluginViewIcon\(entry\.icon\) \?\? IconPalette/);
  assert.doesNotMatch(settingsPage, /settings-nav-icon"><IconBookOpen/);
});
