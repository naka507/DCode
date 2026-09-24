<script setup lang="ts">
/**
 * Create/edit sheet for one subagent definition.
 *
 * The tool grant sits above the prompt because it is the only field with a
 * safety consequence: a delegate that declares `Bash`, `Edit` or `Write` can
 * change the workspace on its own (ADR 0062), and a checkbox group makes that
 * choice explicit instead of hiding it in frontmatter the user has to remember
 * to write.
 *
 * The `SubagentEditorSheet` component. The framework-free
 * half (`SubagentDraft`, `MAX_SUBAGENT_BYTES`, `subagentTemplate`,
 * `emptySubagentDraft`, `draftFromRecord`, `draftFromDefinition`,
 * `subagentSlug`, `applySubagentPreset`, `resetSubagentTemplate`,
 * `subagentDraftError`, `splitSubagentToolGrant`, `mergeSubagentToolGrant`,
 * `subagentPresetCopyKey`) already lives in `./subagent-editor` — the "split
 * module" this tree records in `docs/ARCHITECTURE.md` — and every one of those
 * names is re-exported from here so a consumer keeps one specifier.
 *
 * The decisions that are not mechanical:
 *
 * 1. **`portalOverlay(..)` is `<Teleport :to="overlayRoot()">`.** The sheet is
 *     mounted on the viewport-fixed host so a transformed ancestor
 *     cannot trap `position: fixed`; `lib/overlay-root.ts` is the same host and
 *     `SkillEditorSheet.vue` already teleports there.
 *  2. **The five local components (`PresetChip`, `PresetPicker`,
 *     `ManagementScope`, `ModelField`, `AdvancedFields`) are inlined.** An SFC
 *     holds one component, so their markup sits in the template where it was
 *     rendered, the way `SkillEditorSheet.vue` inlines its `ManagementScope`.
 * 3. **`onClose` / `onSave` / `onReveal` / `setDraft` are emits.** The
 *     emit form takes no callback props; the page listens with `@close` / `@save` /
 *     `@reveal` / `@update:draft`. `onReveal` being optional is kept: the
 *     reveal button renders only while editing *and* a handler is bound, which
 *     is what `editing && onReveal` tested. A declared emit never reaches
 *     `$attrs`, so the presence test reads the raw vnode props (`canReveal`),
 *     the shape `ConversationMinimap.vue` uses for the same problem.
 *  4. **The `useEffect` Escape handler is `onMounted` / `onUnmounted`.** The
 *     listener re-bound on `[saving, onClose]`; here it is installed
 *     once and reads the live `saving` prop, so the binding cannot go stale —
 *     the same shape `SkillEditorSheet.vue` uses.
 *  5. **`hidden={!open}` is `:hidden="!open"`.** `hidden` is an HTML boolean
 *     attribute, so Vue renders it as `hidden=""` and removes it when false,
 *     which is exactly the boolean behaviour the stylesheet relies on. Its
 *     `.ext-sheet-advanced-body[hidden]` rule therefore still matches.
 *  6. **`aria-hidden="true"` is explicit** on the advanced-toggle chevron;
 *     a bare Vue attribute renders `""` where `"true"` is intended.
 *  7. **`useAppStore.getState()` is `store.appState`.** The model field's
 *     empty-state button switches the Settings tab through the shallow-ref
 *     payload; `getState()` is deliberately absent from this tree's store.
 *
 * The utility class names are copied verbatim from the markup; the
 * hand-written partials under `src/renderer/styles/` never defined them, so they
 * are allowlisted for this file in `tests/helpers/class-contract.mjs`.
 */
import { computed, getCurrentInstance, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  MAX_SUBAGENT_MAX_TOKENS,
  SUBAGENT_ASSIGNABLE_TOOLS,
  SUBAGENT_PRESETS,
  SUBAGENT_THINKING_LEVELS,
  findSubagentPreset,
  isSubagentMutatingTool,
  type SubagentThinkingLevel,
  type UserSubagentRecord,
} from "@dcode/shared";
import { useAppStore } from "../../stores/app-store";
import { IconChevronRight, IconFolderOpen, IconX } from "../../lib/icons";
import Button from "../ui/Button.vue";
import Field from "../ui/Field.vue";
import Input from "../ui/Input.vue";
import Textarea from "../ui/Textarea.vue";
import HelpIcon from "../ui/HelpIcon.vue";
import TooltipButton from "../TooltipButton.vue";
import { overlayRoot } from "../../lib/overlay-root";
import {
  groupSubagentModelChoices,
  subagentModelChoices,
  subagentModelOrphanPin,
  subagentModelSelectValue,
} from "./subagent-models";
import SettingsMenuSelect from "./SettingsMenuSelect.vue";
import SubagentFallbackModels from "./SubagentFallbackModels.vue";
import SubagentModelPicker from "./SubagentModelPicker.vue";
import {
  BLANK_SUBAGENT_PRESET_ID,
  MAX_SUBAGENT_BYTES,
  applySubagentPreset,
  resetSubagentTemplate,
  subagentDraftError,
  subagentPresetCopyKey,
  subagentSlug,
  subagentTemplate,
  type SubagentDraft,
} from "./subagent-editor";

/*
  The framework-free half lives in `./subagent-editor`, and
  `AgentSubagentsPage.vue` imports its names from one specifier.
  `<script setup>` cannot contain ES module exports, so they are re-exported
  from the plain `<script>` block at the end of this file — the shape
  `ActivityGroup.vue` uses for its sibling components.
*/

/* See the plain `<script>` block below: the framework-free half's names are
   re-exported there so `AgentSubagentsPage.vue` keeps importing every
   name from one specifier. */
const props = withDefaults(
  defineProps<{
    draft: SubagentDraft;
    editing: UserSubagentRecord | null;
    saving: boolean;
    /** Template chip to select on create, e.g. after Copy as mine. */
    initialPresetId?: string;
  }>(),
  { initialPresetId: undefined },
);

const emit = defineEmits<{
  "update:draft": [draft: SubagentDraft];
  close: [];
  save: [];
  reveal: [];
}>();

const { t } = useI18n();
const store = useAppStore();

const providers = computed(() => store.appState?.providers ?? []);
const copiedPreset = computed(
  () => Boolean(props.initialPresetId && findSubagentPreset(props.initialPresetId)),
);
const nameTouched = ref(Boolean(props.editing) || copiedPreset.value);
const presetId = ref<string | null>(
  copiedPreset.value && props.initialPresetId
    ? props.initialPresetId
    : BLANK_SUBAGENT_PRESET_ID,
);
const advancedOpen = ref(Boolean(props.editing));

const errorKey = computed(() => subagentDraftError(props.draft));
const pristine = computed(
  () => !props.editing && !props.draft.name.trim() && !props.draft.description.trim(),
);
const bytes = computed(() => new TextEncoder().encode(props.draft.body).length);
const slug = computed(() => props.draft.id || subagentSlug(props.draft.name));
const modelChoices = computed(() => subagentModelChoices(providers.value));
const modelGroups = computed(() => groupSubagentModelChoices(modelChoices.value));
const orphanModel = computed(() => subagentModelOrphanPin(props.draft.model, modelChoices.value));
const modelValue = computed(() => subagentModelSelectValue(props.draft.model, modelChoices.value));

/** The `PresetPicker`: the desc line under the chip row. */
const presetDescKey = computed(() =>
  presetId.value === BLANK_SUBAGENT_PRESET_ID
    ? "extensions.subagents.presetBlankDesc"
    : presetId.value
      ? subagentPresetCopyKey(presetId.value, "desc")
      : null,
);

const instance = getCurrentInstance();
/**
 * The reveal button renders only when the caller passes an
 * `onReveal`, i.e. `editing && onReveal`. A declared emit is consumed by the
 * compiler before `$attrs`, so the emit form has no prop to test; the question
 * is asked of the raw vnode props instead — the slot `@reveal` lands in. Same
 * shape and same caveats as `ConversationMinimap.vue`'s `canRevealEarlier`.
 */
function canReveal(): boolean {
  return typeof instance?.vnode.props?.onReveal === "function";
}

const thinkingOptions = computed(() => [
  { id: "", label: t("extensions.subagents.thinkingInherit") },
  { id: "omit", label: t("extensions.subagents.thinkingOmit") },
  ...SUBAGENT_THINKING_LEVELS.filter((level) => level !== "omit").map((level) => ({
    id: level,
    label: level,
  })),
]);

/* See note 4: one listener for the sheet's lifetime, reading the live props. */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape" && !props.saving) emit("close");
}
onMounted(() => window.addEventListener("keydown", onKeyDown));
onUnmounted(() => window.removeEventListener("keydown", onKeyDown));

function set<K extends keyof SubagentDraft>(key: K, value: SubagentDraft[K]): void {
  emit("update:draft", { ...props.draft, [key]: value });
}

// Naming a new delegate seeds the body once, so the editor is never a blank
// page but never overwrites something the user has started writing either.
function setName(value: string): void {
  const next: SubagentDraft = { ...props.draft, name: value };
  if (!nameTouched.value && !props.editing && !props.draft.body.trim()) {
    next.body = subagentTemplate(value);
  }
  emit("update:draft", next);
}

function toggleTool(tool: string, on: boolean): void {
  set(
    "tools",
    on
      ? // Keep the canonical order, so the document reads the same however the
        // boxes were clicked.
        SUBAGENT_ASSIGNABLE_TOOLS.filter(
          (candidate) => candidate === tool || props.draft.tools.includes(candidate),
        )
      : props.draft.tools.filter((candidate) => candidate !== tool),
  );
}

function applyPreset(nextId: string): void {
  presetId.value = nextId;
  if (!nextId || nextId === BLANK_SUBAGENT_PRESET_ID) {
    emit("update:draft", resetSubagentTemplate(props.draft));
    nameTouched.value = false;
    return;
  }
  const preset = SUBAGENT_PRESETS.find((candidate) => candidate.id === nextId);
  if (!preset) return;
  emit("update:draft", applySubagentPreset(props.draft, preset));
  nameTouched.value = true;
}

function presetNameLabel(id: string): string {
  const key = subagentPresetCopyKey(id, "name");
  const preset = SUBAGENT_PRESETS.find((candidate) => candidate.id === id);
  return key ? t(key) : (preset?.name ?? id);
}

function onOverlayMouseDown(event: MouseEvent): void {
  if (event.target === event.currentTarget && !props.saving) emit("close");
}

function onMaxTokensInput(event: Event): void {
  set("maxTokens", Number.parseInt((event.target as HTMLInputElement).value, 10) || 0);
}

function onNameInput(event: Event): void {
  nameTouched.value = true;
  setName((event.target as HTMLInputElement).value);
}

function openModelSettings(): void {
  store.appState?.setSettingsTab("agent");
}
</script>

<script lang="ts">
/**
 * See the note above the `./subagent-editor` import: `<script setup>` cannot
 * contain ES module exports, so the framework-free half's names are
 * re-exported from this plain block, which keeps one specifier
 * (`./SubagentEditorSheet.vue`) working for `AgentSubagentsPage.vue`.
 */
export {
  BLANK_SUBAGENT_PRESET_ID,
  MAX_SUBAGENT_BYTES,
  SUBAGENT_PRESET_COPY,
  applySubagentPreset,
  draftFromDefinition,
  draftFromRecord,
  emptySubagentDraft,
  mergeSubagentToolGrant,
  resetSubagentTemplate,
  splitSubagentToolGrant,
  subagentDraftError,
  subagentPresetCopyKey,
  subagentSlug,
  subagentTemplate,
  type SubagentDraft,
} from "./subagent-editor";
</script>

<template>
  <Teleport :to="overlayRoot()">
    <div
      class="overlay ext-sheet-overlay"
      role="presentation"
      @mousedown="onOverlayMouseDown"
    >
      <div
        class="dialog ext-sheet"
        role="dialog"
        :aria-modal="true"
        aria-labelledby="subagent-sheet-title"
      >
        <div class="ext-sheet-head">
          <div>
            <h3 id="subagent-sheet-title" class="ext-sheet-title">
              {{
                editing
                  ? t("extensions.subagents.editTitle")
                  : t("extensions.subagents.addTitle")
              }}
            </h3>
          </div>
          <TooltipButton
            as="button"
            type="button"
            class="ext-sheet-close"
            :aria-label="t('common.close')"
            :label="t('common.close')"
            @click="emit('close')"
          >
            <IconX :size="14" />
          </TooltipButton>
        </div>

        <div class="ext-sheet-body">
 <!-- the `PresetPicker`; see note 2. -->
          <div v-if="!editing" class="ext-field-group">
            <div class="ext-field-label">
              {{ t("extensions.subagents.presetLabel") }}
              <HelpIcon v-if="presetDescKey" :label="t(presetDescKey)" />
            </div>
            <div
              class="ext-preset-pick"
              role="group"
              :aria-label="t('extensions.subagents.presetLabel')"
            >
              <button
                v-for="preset in SUBAGENT_PRESETS"
                :key="preset.id"
                type="button"
                class="ext-preset-chip"
                :class="{ 'is-selected': presetId === preset.id }"
                :aria-pressed="presetId === preset.id"
                @click="applyPreset(preset.id)"
              >
                <span class="ext-preset-chip-name">{{ presetNameLabel(preset.id) }}</span>
              </button>
              <button
                type="button"
                class="ext-preset-chip"
                :class="{ 'is-selected': presetId === BLANK_SUBAGENT_PRESET_ID }"
                :aria-pressed="presetId === BLANK_SUBAGENT_PRESET_ID"
                @click="applyPreset(BLANK_SUBAGENT_PRESET_ID)"
              >
                <span class="ext-preset-chip-name">
                  {{ t("extensions.subagents.presetBlank") }}
                </span>
              </button>
            </div>
          </div>

          <Field
            :label="t('extensions.subagents.name')"
            :hint="
              slug
                ? t('extensions.subagents.slugHint', { id: slug })
                : undefined
            "
          >
            <Input
              :value="draft.name"
              :placeholder="t('extensions.subagents.namePlaceholder')"
              @input="onNameInput"
            />
          </Field>

          <Field :label="t('extensions.subagents.description')">
            <Textarea
              :value="draft.description"
              :rows="2"
              :placeholder="t('extensions.subagents.descriptionPlaceholder')"
              @input="set('description', ($event.target as HTMLTextAreaElement).value)"
            />
          </Field>

          <div class="ext-field-group">
            <div class="ext-field-label">
              {{ t("extensions.subagents.tools") }}
              <HelpIcon
                v-if="draft.inheritTools"
                :label="t('extensions.subagents.toolsInheritHint')"
              />
              <HelpIcon
                v-else-if="draft.tools.some(isSubagentMutatingTool)"
                :label="t('extensions.subagents.mutatingHint')"
              />
              <HelpIcon
                v-else
                :label="t('extensions.subagents.toolsHint')"
              />
            </div>
            <div
              class="ext-tool-pick"
              role="group"
              :aria-label="t('extensions.subagents.tools')"
            >
              <label
                class="ext-tool-opt"
                :class="{ 'is-on': draft.inheritTools }"
              >
                <input
                  type="checkbox"
                  :checked="draft.inheritTools"
                  @change="
                    set('inheritTools', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span>{{ t("extensions.subagents.toolsInherit") }}</span>
              </label>
              <label
                v-for="tool in SUBAGENT_ASSIGNABLE_TOOLS"
                :key="tool"
                class="ext-tool-opt"
                :class="{
                  'is-on': draft.tools.includes(tool),
                  'is-mutating': isSubagentMutatingTool(tool),
                }"
              >
                <input
                  type="checkbox"
                  :checked="draft.tools.includes(tool)"
                  @change="
                    toggleTool(tool, ($event.target as HTMLInputElement).checked)
                  "
                />
                <code>{{ tool }}</code>
              </label>
            </div>
          </div>

          <div class="ext-field-group">
            <div class="ext-field-label ext-field-label-row">
              <span>{{ t("extensions.subagents.body") }}</span>
              <span
                class="ext-byte-count"
                :class="{
                  'is-over': bytes > MAX_SUBAGENT_BYTES,
                  'is-near': bytes <= MAX_SUBAGENT_BYTES && bytes > MAX_SUBAGENT_BYTES * 0.8,
                }"
              >
                {{
                  t("extensions.subagents.bytes", {
                    used: Math.round(bytes / 1024),
                    max: Math.round(MAX_SUBAGENT_BYTES / 1024),
                  })
                }}
              </span>
            </div>
            <Textarea
              class="ext-skill-body"
              :value="draft.body"
              :rows="8"
              :spellcheck="false"
              :placeholder="subagentTemplate('')"
              :aria-label="t('extensions.subagents.body')"
              @input="set('body', ($event.target as HTMLTextAreaElement).value)"
            />
          </div>

 <!-- the `AdvancedFields`; see note 2. -->
          <div class="ext-sheet-advanced">
            <button
              type="button"
              class="ext-sheet-advanced-toggle"
              :aria-expanded="advancedOpen"
              aria-controls="subagent-sheet-advanced"
              @click="advancedOpen = !advancedOpen"
            >
              <IconChevronRight :size="12" aria-hidden="true" />
              {{ t("settings.advanced") }}
            </button>
            <div id="subagent-sheet-advanced" class="ext-sheet-advanced-body" :hidden="!advancedOpen">
 <!-- the `ModelField`; see note 2. -->
              <div class="ext-field-pair">
                <Field
                  :label="t('extensions.subagents.model')"
                  :hint="
                    modelChoices.length > 0
                      ? t('extensions.subagents.modelHint')
                      : t('extensions.subagents.modelPickEmpty')
                  "
                >
                  <div v-if="modelChoices.length === 0" class="ext-field-empty">
                    <Button variant="secondary" size="sm" @click="openModelSettings">
                      {{ t("extensions.subagents.modelPickEmptyAction") }}
                    </Button>
                  </div>
                  <SubagentModelPicker
                    v-else
                    :value="modelValue"
                    :groups="modelGroups"
                    :orphan-pin="orphanModel"
                    @change="(next) => set('model', next)"
                  />
                </Field>
                <Field
                  :label="t('extensions.subagents.thinking')"
                  :hint="t('extensions.subagents.thinkingHint')"
                >
                  <SettingsMenuSelect
                    :full-width="true"
                    :label="t('extensions.subagents.thinking')"
                    :value="draft.thinkingLevel"
                    :options="thinkingOptions"
                    @change="(id) => set('thinkingLevel', id as SubagentThinkingLevel | '')"
                  />
                </Field>
              </div>
              <SubagentFallbackModels
                :primary="draft.model"
                :values="draft.fallbackModels"
                :choices="modelChoices"
                @change="(fallbackModels) => set('fallbackModels', fallbackModels)"
              />

              <Field
                :label="t('extensions.subagents.maxTokens')"
                :hint="
                  t('extensions.subagents.maxTokensHint', {
                    max: MAX_SUBAGENT_MAX_TOKENS.toLocaleString(),
                  })
                "
              >
                <Input
                  type="number"
                  :min="1"
                  :max="MAX_SUBAGENT_MAX_TOKENS"
                  :placeholder="t('extensions.subagents.maxTokensDefault')"
                  :value="draft.maxTokens > 0 ? String(draft.maxTokens) : ''"
                  @input="onMaxTokensInput"
                />
              </Field>
              <div class="ext-field-group">
                <div class="ext-field-label">{{ t("settings.scope") }}</div>
 <!-- the `ManagementScope`; see note 2. -->
                <div class="agent-mcp-scope">
                  <div class="agent-mcp-scope-copy">
                    <span class="agent-mcp-scope-label">
                      {{ t("settings.globalScope") }}
                      <HelpIcon :label="t('settings.subagentsOnlyGlobal')" />
                    </span>
                  </div>
                  <button
                    type="button"
                    class="settings-toggle"
                    :class="{ on: draft.enabled }"
                    role="switch"
                    :aria-checked="draft.enabled"
                    :aria-label="
                      t('settings.enableCapability', { name: draft.name || draft.id })
                    "
                    @click="set('enabled', !draft.enabled)"
                  >
                    <span class="settings-toggle-thumb" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p
          v-if="errorKey && !pristine"
          id="subagent-sheet-error"
          class="ext-sheet-error"
          role="alert"
        >
          {{ t(errorKey) }}
        </p>
        <div class="ext-sheet-actions">
          <Button v-if="editing && canReveal()" variant="ghost" @click="emit('reveal')">
            <IconFolderOpen :size="13" />
            {{ t("extensions.subagents.reveal") }}
          </Button>
          <div class="ext-sheet-actions-end">
            <Button variant="ghost" :disabled="saving" @click="emit('close')">
              {{ t("common.cancel") }}
            </Button>
            <Button
              variant="primary"
              :disabled="saving || Boolean(errorKey)"
              :title="errorKey ? t(errorKey) : undefined"
              @click="emit('save')"
            >
              {{ saving ? t("common.saving") : t("common.save") }}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
