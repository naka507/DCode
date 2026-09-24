/**
 * Prompt-enhancement settings contract.
 *
 * Covers the settings half of the prompt-enhancement contract (007889e2,
 * reshaped by f79199a4 and 720d8770) plus the shared-types and stylesheet hunks
 * of the same commit. The transport half — the typed `promptEnhance` bridge,
 * the 60-second ceiling, the one-shot runtime — is already covered by
 * `tests/prompt-enhancement.test.mjs` in this tree, so it is not repeated here.
 *
 * Retranslated assertions, each also noted at its site:
 *
 *  - the components under test are
 *    `../src/renderer/features/settings/PromptEnhancementCard.vue`,
 *    `../src/renderer/components/settings/EnhancementModelCard.vue` and
 *    `../src/renderer/components/settings/ModelConfigPage.vue`, reached from
 *    `../src/renderer/pages/SettingsPage.vue` through
 *    `../src/renderer/lib/settings-search.ts`.
 *  - `t("settings.x")` → the `t('settings.x')` single-quoted form; the
 *    assertions accept either quote rather than pinning one.
 *  - `disabled={!hasCustomTemplate}` / `disabled={noReasoning}` → the
 *    `:disabled="…"` binding form.
 *  - `portalOverlay(...)` → `<Teleport :to="overlayRoot()">`: the Vue sheet
 *    mounts on the same viewport-fixed host (`lib/overlay-root.ts`).
 *  - `const templateChanged = savedTemplateValue !== savedTemplate` →
 *    `… !== savedTemplate.value`, because the saved value is a `computed` ref.
 *  - The `pickModel` slice ends at `function onTriggerClick` instead of
 *    `return (`: an SFC's setup ends at the template, not at a `return`.
 *  - `{tab === "ai" && settings && (` → `v-if="tab === 'ai' && settings"`, and
 *    the same for the `shortcuts` boundary that closes the slice.
 *  - `sharedTypesSource` is `readSharedTypesSource()`, a concatenation over this
 *    tree's `src/shared/types/`.
 *
 * Assertions with no equivalent in this tree:
 *
 *  - `crates/host-core/src/rpc/mod.rs` does not live in dcode (the Rust host is
 *    a separate checkout), so the `prompt_enhancement_template_error` /
 *    `MAX_PROMPT_ENHANCEMENT_TEMPLATE_CHARS` / `promptEnhancementUserTemplate
 *    must contain` assertions are dropped. The renderer half of the same rule —
 *    `templateMissingVariable` and `templateTooLong` refusing the save locally —
 *    is asserted below instead.
 *  - `readComposerSource()` / `readMainSource()` are not needed: the transport
 *    assertions they carried are already in `tests/prompt-enhancement.test.mjs`.
 *
 * The two stylesheet assertions at the end come from the `settings.css` hunk of
 * the same commit (007889e2), not from the test file, which never greps them.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";
import { readSharedTypesSource } from "./helpers/source-contracts.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [promptCard, modelCard, settingsPage, modelPage, search, shared, en, zh] =
  await Promise.all([
    read("../src/renderer/features/settings/PromptEnhancementCard.vue"),
    read("../src/renderer/components/settings/EnhancementModelCard.vue"),
    read("../src/renderer/pages/SettingsPage.vue"),
    read("../src/renderer/components/settings/ModelConfigPage.vue"),
    read("../src/renderer/lib/settings-search.ts"),
    read("../src/shared/prompt-enhancement.ts"),
    read("../src/i18n/locales/en/index.ts"),
    read("../src/i18n/locales/zh-CN/index.ts"),
  ]);
const sharedTypes = await readSharedTypesSource();
const styles = await loadStyles();

test("the shared settings type carries the prompt-enhancement fields", () => {
  // The prompt-enhancement fields the card reads off the shared settings type.
  assert.match(sharedTypes, /promptEnhancementCustomTemplate\?: boolean/);
  assert.match(sharedTypes, /promptEnhancementUserTemplate\?: string/);
  assert.match(sharedTypes, /promptEnhancementProviderId\?: string/);
  assert.match(sharedTypes, /promptEnhancementModelId\?: string/);
  assert.match(sharedTypes, /promptEnhancementThinkingLevel\?: ThinkingLevel/);
});

test("prompt-enhancement settings expose templates, restore, and the draft variable", () => {
  // The card is reachable from the AI settings tab.
  assert.match(settingsPage, /PromptEnhancementCard/);
  assert.match(promptCard, /PROMPT_ENHANCEMENT_DEFAULT_USER_TEMPLATE/);
  assert.match(promptCard, /promptEnhancementUserTemplate/);
  // The system prompt is not overridable; the card must not offer a field for it.
  assert.doesNotMatch(promptCard, /promptEnhancementSystemPrompt/);
  // Editing happens in a sheet, opened from the card, matching the subagent editor.
  assert.match(promptCard, /ext-sheet-overlay/);
  assert.match(promptCard, /ext-sheet-actions/);
  // `portalOverlay` is the Teleport to the viewport-fixed overlay host here.
  assert.match(promptCard, /Teleport/);
  assert.match(promptCard, /overlayRoot\(\)/);
  assert.match(promptCard, /promptEnhancementCustomTemplate/);
  // The switch is the standard settings toggle, and Edit is the subagent
  // list's icon button rather than a labelled action in the row.
  assert.match(promptCard, /settings-toggle/);
  assert.match(promptCard, /role="switch"/);
  // The switch is usable only once a template has been saved, and saving one
  // turns it on.
  assert.match(promptCard, /hasCustomTemplate/);
  assert.match(promptCard, /:disabled="!hasCustomTemplate"/);
  assert.match(promptCard, /promptEnhancementCustomTemplateNeedsTemplate/);
  assert.match(promptCard, /promptEnhancementCustomTemplate: templateChanged/);
  assert.match(
    promptCard,
    /const templateChanged = savedTemplateValue !== savedTemplate\.value/,
  );
  assert.match(promptCard, /settings-icon-button/);
  assert.match(promptCard, /IconPencil/);
  assert.match(promptCard, /EnhancementModelCard/);
  // Model and reasoning rows are composed in, not inlined on this file.
  assert.doesNotMatch(promptCard, /promptEnhancementProviderId/);
  assert.doesNotMatch(promptCard, /promptEnhancementThinkingLevel/);
  assert.doesNotMatch(promptCard, /promptEnhancementModelId/);
  assert.doesNotMatch(promptCard, /SubagentModelPicker/);
  // A save that would drop the draft variable or exceed the host-core bound
  // is refused before it is sent.
  assert.match(promptCard, /templateMissingVariable/);
  assert.match(promptCard, /templateTooLong/);
  assert.match(promptCard, /isValidPromptEnhancementUserTemplate/);

  // The defaults live in shared so the settings page can display the same text
  // the runtime sends, and the placeholder is substituted literally.
  assert.match(shared, /export const PROMPT_ENHANCEMENT_DRAFT_VARIABLE/);
  assert.match(shared, /renderPromptEnhancementUserPrompt/);
  assert.match(shared, /resolvePromptEnhancementTemplates/);
  assert.doesNotMatch(shared, /\.replace\(PROMPT_ENHANCEMENT_DRAFT_VARIABLE, draft\)/);
});

test("the enhancement model and reasoning are rows on the Prompt enhancement card", () => {
  const aiStart = settingsPage.indexOf('v-if="tab === \'ai\' && settings"');
  const shortcutsStart = settingsPage.indexOf(
    'v-if="tab === \'shortcuts\' && settings"',
  );
  const aiSource = settingsPage.slice(aiStart, shortcutsStart);
  assert.match(aiSource, /PromptEnhancementCard/);
  assert.doesNotMatch(aiSource, /EnhancementModelCard/);
  assert.match(promptCard, /EnhancementModelCard/);
  assert.doesNotMatch(modelPage, /EnhancementModelCard/);
  assert.doesNotMatch(modelPage, /promptEnhancementProviderId/);

  const aiSearch = search.slice(search.indexOf('id: "ai"'), search.indexOf('id: "shortcuts"'));
  const agentSearch = search.slice(
    search.indexOf('id: "agent"'),
    search.indexOf('id: "skills"'),
  );
  assert.match(aiSearch, /promptEnhancementTitle/);
  assert.match(aiSearch, /promptEnhancementModelTitle/);
  assert.match(aiSearch, /promptEnhancementThinking/);
  assert.doesNotMatch(agentSearch, /promptEnhancementModelTitle/);
  assert.doesNotMatch(agentSearch, /promptEnhancementThinking/);

  assert.doesNotMatch(modelCard, /promptEnhancementModelTitle/);
  assert.doesNotMatch(modelCard, /SettingsCard/);
  assert.match(modelCard, /t\(['"]settings\.promptEnhancementModel['"]\)/);

  // Same control as the default-model row: one anchored menu, one search field.
  assert.match(modelCard, /AnchoredMenu/);
  assert.match(modelCard, /model-default-anchor/);
  assert.match(modelCard, /promptEnhancementProviderId/);
  assert.match(modelCard, /promptEnhancementModelId/);
  assert.match(modelCard, /promptEnhancementModelFollow/);
  assert.match(modelCard, /promptEnhancementModelUnavailable/);
  assert.match(modelCard, /pickModel/);

  assert.match(modelCard, /SettingsRow/);
});

test("the reasoning row follows the selected model's real ladder", () => {
  // Reuse the Composer's model-aware resolution instead of the canonical list.
  assert.match(modelCard, /thinkingProviderForModel/);
  assert.match(modelCard, /thinkingLevelForProvider/);
  assert.match(modelCard, /reasoningProvider/);
  assert.match(modelCard, /levelOptions/);
  // A pinned model without reasoning still lists `off` and disables the row.
  assert.match(modelCard, /noReasoning/);
  assert.match(modelCard, /:disabled="noReasoning"/);
  // Switching model re-clamps the stored level onto the new model.
  const pickModel = modelCard.slice(
    modelCard.indexOf("function pickModel"),
    modelCard.indexOf("function onTriggerClick"),
  );
  assert.match(pickModel, /thinkingLevelForProvider\(nextProvider, stored\)/);
  // No follow-the-session option in this row.
  assert.doesNotMatch(modelCard, /promptEnhancementThinkingFollow/);
});

test("prompt-enhancement locale coverage includes the settings copy", () => {
  for (const source of [en, zh]) {
    for (const key of [
      "promptEnhancementTitle",
      "promptEnhancementDesc",
      "promptEnhancementEdit",
      "promptEnhancementUserTemplate",
      "promptEnhancementUserTemplateDesc",
      "promptEnhancementInsertDraft",
      "promptEnhancementRestore",
      "promptEnhancementCustomTemplate",
      "promptEnhancementCustomTemplateDesc",
      "promptEnhancementCustomTemplateNeedsTemplate",
      "promptEnhancementMissingDraftVariable",
      "promptEnhancementTooLong",
      "promptEnhancementSaveError",
    ]) {
      assert.match(source, new RegExp(`${key}:`));
    }
  }
});

test("the enhancement-model copy exists in both reference locales", () => {
  for (const source of [en, zh]) {
    for (const key of [
      "promptEnhancementModelTitle",
      "promptEnhancementModel",
      "promptEnhancementModelFollow",
      "promptEnhancementModelUnavailable",
      "promptEnhancementThinking",
      "promptEnhancementThinkingDesc",
      "promptEnhancementThinkingOff",
    ]) {
      assert.match(source, new RegExp(`${key}:`));
    }
  }
});

test("the prompt-enhancement card styles ship with the card", () => {
  // 007889e2's settings.css hunk: the toggle + icon-button control cluster and
  // the disabled switch both belong to this card.
  assert.match(
    styles,
    /\.settings-row-control:has\(> \.settings-toggle \+ \.settings-icon-button\)\s*\{[\s\S]*?gap:\s*8px/,
  );
  assert.match(
    styles,
    /\.settings-toggle:disabled\s*\{[\s\S]*?cursor:\s*not-allowed/,
  );
  assert.match(
    styles,
    /\.settings-toggle\.on:disabled:hover\s*\{[\s\S]*?background:\s*var\(--ds-accent\)/,
  );
});
