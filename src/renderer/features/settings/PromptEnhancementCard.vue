<script setup lang="ts">
/**
 * Prompt-enhancement settings (ADR 0121).
 *
 * This card owns the Composer Enhance prompt action: a switch that chooses
 * between the built-in user template and a saved one, the settings icon button
 * that opens the template editor, and the model plus reasoning rows that pick
 * which model runs the rewrite.
 *
 * What is deliberately not editable: the system prompt. It carries the rewrite
 * contract the feature is verified against (proper-noun preservation, language
 * following without meta notes, the output contract), so it stays a built-in
 * default and host-core drops any stored override.
 *
 * The template field shows the built-in default text when no override is saved,
 * so the editor opens on the value in force, and "restore default" is
 * self-explanatory. Editing the field back to the exact default text clears the
 * override rather than storing a frozen copy, so a later product improvement to
 * the default still reaches users who never customized it.
 *
 * The `PromptEnhancementCard` component. The decisions that are not mechanical:
 *
 *  1. **`portalOverlay(...)` is `<Teleport :to="overlayRoot()">`**, the shape
 *     `SubagentEditorSheet.vue` already uses: the sheet is mounted on the
 *     viewport-fixed host so a transformed ancestor cannot trap
 *     `position: fixed`, and `lib/overlay-root.ts` is that host.
 *  2. **The `useEffect` Escape handler is `onMounted` / `onUnmounted`.** The handler was
 *     bound it inside the sheet, which was itself conditionally rendered; here
 *     the sheet is inlined, so the listener lives for the card's lifetime and
 *     reads the live `saving` ref, so the binding cannot go stale. Closing an
 *     already-closed sheet is a no-op, which is the only behavioural
 *     difference — the same shape and the same reasoning as
 *     `SubagentEditorSheet.vue` note 4.
 *  3. **The nested `PromptEnhancementEditorSheet` is inlined.** An SFC holds one
 *     component, so the sheet's markup and its local state sit in this file
 *     where they were rendered before; `SubagentEditorSheet.vue` inlines its five
 *     local components the same way.
 *  4. **The editor is `v-if`-mounted, not `hidden`.** The editor was conditionally
 *     rendered (`{editorOpen ? <PromptEnhancementEditorSheet …/> : null}`), so
 *     closing the sheet abandons the draft — `v-if` reproduces that contract
 *     exactly, where a `v-show` would keep the draft alive.
 *  5. **The plain `<textarea>` stays a plain `<textarea>`.** The
 *     shared `Textarea` wrapper does not forward a ref and the insert action
 *     needs one to place the caret; in Vue a template ref on a single-root
 *     component yields the component instance rather than the element, so the
 *     element is written out directly, with the same classes the wrapper adds.
 *  6. **`t` is not a prop.** Every component in this tree calls `useI18n()`
 *     itself (see the header comments in `ComposerToolbar.vue` /
 *     `ComposerStatus.vue`).
 *  7. **`aria-disabled` is explicit (`:aria-disabled="!hasCustomTemplate"`)**;
 *     the switch also carries the real `disabled` attribute, as before.
 *  8. **`cx("settings-toggle", customTemplate && "on")` is a static `class`
 *     plus an object `:class` binding**, the form the class-name contract reads.
 *
 * `settings-command-shell-state` is the state-text modifier the markup
 * carries and no stylesheet ever defines; it is allowlisted
 * for this file in `tests/helpers/class-contract.mjs`, the same exemption
 * `CommandShellRow.vue` and `LargePasteThresholdRow.vue` already hold.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AppSettings } from "@dcode/shared";
import {
  PROMPT_ENHANCEMENT_DEFAULT_USER_TEMPLATE,
  PROMPT_ENHANCEMENT_DRAFT_VARIABLE,
  PROMPT_ENHANCEMENT_TEMPLATE_MAX_LENGTH,
  isValidPromptEnhancementUserTemplate,
} from "@dcode/shared";
import { IconPencil, IconX } from "../../lib/icons";
import { overlayRoot } from "../../lib/overlay-root";
import Button from "../../components/ui/Button.vue";
import Field from "../../components/ui/Field.vue";
import TooltipButton from "../../components/TooltipButton.vue";
import SettingsCard from "./primitives/SettingsCard.vue";
import SettingsRow from "./primitives/SettingsRow.vue";
import EnhancementModelCard from "../../components/settings/EnhancementModelCard.vue";

const props = defineProps<{
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}>();

const { t } = useI18n();

const editorOpen = ref(false);
const customTemplate = computed(() => props.settings.promptEnhancementCustomTemplate === true);
// A saved, usable template is what makes the switch meaningful.
const hasCustomTemplate = computed(() =>
  isValidPromptEnhancementUserTemplate(props.settings.promptEnhancementUserTemplate),
);

/*
  The editor itself. Drafts are local until Save, so closing the sheet abandons
  the edit — the same contract as the subagent editor.
*/
const savedTemplate = computed(() => props.settings.promptEnhancementUserTemplate ?? "");
const templateDraft = ref("");
const saving = ref(false);
const saveError = ref(false);
const templateRef = ref<HTMLTextAreaElement | null>(null);

/** Opened: the field starts on the value in force. */
function openEditor(): void {
  templateDraft.value =
    savedTemplate.value || PROMPT_ENHANCEMENT_DEFAULT_USER_TEMPLATE;
  saveError.value = false;
  editorOpen.value = true;
}

const templateMissingVariable = computed(
  () =>
    templateDraft.value.trim().length > 0 &&
    !isValidPromptEnhancementUserTemplate(templateDraft.value),
);
const templateTooLong = computed(
  () => [...templateDraft.value].length > PROMPT_ENHANCEMENT_TEMPLATE_MAX_LENGTH,
);
const dirty = computed(
  () =>
    templateDraft.value !==
    (savedTemplate.value || PROMPT_ENHANCEMENT_DEFAULT_USER_TEMPLATE),
);

function close(): void {
  editorOpen.value = false;
}

/* See note 2: one listener for the sheet's lifetime, reading the live state. */
function onKeyDown(event: KeyboardEvent): void {
  // Escape closes only when nothing is in flight, so a save cannot be
  // abandoned halfway through.
  if (event.key === "Escape" && !saving.value) close();
}
onMounted(() => window.addEventListener("keydown", onKeyDown));
onUnmounted(() => window.removeEventListener("keydown", onKeyDown));

function insertDraftVariable(): void {
  const element = templateRef.value;
  if (!element) {
    templateDraft.value = `${templateDraft.value}${PROMPT_ENHANCEMENT_DRAFT_VARIABLE}`;
    return;
  }
  const start = element.selectionStart ?? templateDraft.value.length;
  const end = element.selectionEnd ?? start;
  templateDraft.value = `${templateDraft.value.slice(0, start)}${PROMPT_ENHANCEMENT_DRAFT_VARIABLE}${templateDraft.value.slice(end)}`;
  const caret = start + PROMPT_ENHANCEMENT_DRAFT_VARIABLE.length;
  window.requestAnimationFrame(() => {
    element.focus();
    element.setSelectionRange(caret, caret);
  });
}

function restoreTemplateDefault(): void {
  templateDraft.value = PROMPT_ENHANCEMENT_DEFAULT_USER_TEMPLATE;
}

async function save(): Promise<void> {
  if (templateMissingVariable.value || templateTooLong.value || saving.value) return;
  saving.value = true;
  saveError.value = false;
  try {
    // The default text is never persisted, so a later change to the default
    // still reaches a user who left the field at its default value.
    const savedTemplateValue =
      templateDraft.value === PROMPT_ENHANCEMENT_DEFAULT_USER_TEMPLATE
        ? ""
        : templateDraft.value;
    const templateChanged = savedTemplateValue !== savedTemplate.value;
    await props.saveSettings({
      promptEnhancementUserTemplate: savedTemplateValue,
      // Saving a template switches it on, because the user just wrote one.
      promptEnhancementCustomTemplate: templateChanged
        ? Boolean(savedTemplateValue.trim())
        : props.settings.promptEnhancementCustomTemplate === true,
    });
    close();
  } catch {
    saveError.value = true;
  } finally {
    saving.value = false;
  }
}

function onOverlayMouseDown(event: MouseEvent): void {
  if (event.target === event.currentTarget && !saving.value) close();
}

function onCloseClick(): void {
  if (!saving.value) close();
}
</script>

<template>
  <SettingsCard :title="t('settings.promptEnhancementTitle')">
    <SettingsRow
      :title="t('settings.promptEnhancementCustomTemplate')"
      :description="t('settings.promptEnhancementCustomTemplateDesc')"
    >
      <!--
        The switch selects between a saved custom template and the built-in
        one, so it means nothing until a template has been saved. It is
        disabled rather than hidden: the user can see that the choice exists
        and that editing is what unlocks it.
      -->
      <button
        type="button"
        class="settings-toggle"
        :class="{ on: customTemplate }"
        role="switch"
        :aria-checked="customTemplate"
        :aria-disabled="!hasCustomTemplate"
        :disabled="!hasCustomTemplate"
        :aria-label="t('settings.promptEnhancementCustomTemplate')"
        :title="
          hasCustomTemplate
            ? undefined
            : t('settings.promptEnhancementCustomTemplateNeedsTemplate')
        "
        @click="
          void saveSettings({
            promptEnhancementCustomTemplate: !customTemplate,
          })
        "
      >
        <span class="settings-toggle-thumb" />
      </button>
      <!--
        The subagent list's edit affordance: a tooltipped icon button, so the
        row keeps one control cluster instead of three competing labels.
      -->
      <TooltipButton
        as="button"
        type="button"
        class="settings-icon-button"
        :aria-label="t('settings.promptEnhancementEdit')"
        :label="t('settings.promptEnhancementEdit')"
        @click="openEditor"
      >
        <IconPencil :size="15" />
      </TooltipButton>
    </SettingsRow>

    <EnhancementModelCard />

    <Teleport v-if="editorOpen" :to="overlayRoot()">
      <div
        class="overlay ext-sheet-overlay"
        role="presentation"
        @mousedown="onOverlayMouseDown"
      >
        <div
          class="dialog ext-sheet"
          role="dialog"
          :aria-modal="true"
          aria-labelledby="prompt-enhancement-sheet-title"
        >
          <div class="ext-sheet-head">
            <div>
              <h3 id="prompt-enhancement-sheet-title" class="ext-sheet-title">
                {{ t("settings.promptEnhancementTitle") }}
              </h3>
              <div class="ext-sheet-sub">
                {{ t("settings.promptEnhancementDesc") }}
              </div>
            </div>
            <TooltipButton
              as="button"
              type="button"
              class="ext-sheet-close"
              :aria-label="t('common.close')"
              :label="t('common.close')"
              :disabled="saving"
              @click="onCloseClick"
            >
              <IconX :size="14" />
            </TooltipButton>
          </div>

          <div class="ext-sheet-body">
            <Field
              :label="t('settings.promptEnhancementUserTemplate')"
              :hint="t('settings.promptEnhancementUserTemplateDesc')"
            >
              <!-- A plain textarea: the shared Textarea wrapper does not forward a
                   ref, and the insert action needs one to place the caret. -->
              <textarea
                ref="templateRef"
                class="field-textarea ext-skill-body"
                :value="templateDraft"
                :rows="8"
                :aria-label="t('settings.promptEnhancementUserTemplate')"
                :aria-invalid="templateMissingVariable || templateTooLong"
                :spellcheck="false"
                autocorrect="off"
                autocapitalize="off"
                @input="
                  templateDraft = ($event.target as HTMLTextAreaElement).value
                "
              />
            </Field>

            <span
              v-if="templateMissingVariable"
              class="settings-command-shell-state error"
              role="status"
            >
              {{ t("settings.promptEnhancementMissingDraftVariable") }}
            </span>
            <span
              v-if="templateTooLong"
              class="settings-command-shell-state error"
              role="status"
            >
              {{ t("settings.promptEnhancementTooLong") }}
            </span>

            <div class="settings-panel-actions">
              <Button variant="secondary" type="button" @click="insertDraftVariable">
                {{ t("settings.promptEnhancementInsertDraft") }}
              </Button>
              <Button variant="secondary" type="button" @click="restoreTemplateDefault">
                {{ t("settings.promptEnhancementRestore") }}
              </Button>
            </div>

            <span
              v-if="saveError"
              class="settings-command-shell-state error"
              role="status"
            >
              {{ t("settings.promptEnhancementSaveError") }}
            </span>
          </div>

          <div class="ext-sheet-actions">
            <div class="ext-sheet-actions-end">
              <Button variant="ghost" type="button" :disabled="saving" @click="close">
                {{ t("common.cancel") }}
              </Button>
              <Button
                variant="primary"
                type="button"
                :disabled="
                  !dirty || saving || templateMissingVariable || templateTooLong
                "
                @click="void save()"
              >
                {{ saving ? t("common.saving") : t("common.save") }}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </SettingsCard>
</template>
