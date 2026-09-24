<script setup lang="ts">
/**
 * Create/edit sheet for one user skill.
 *
 * The `SkillEditorSheet` component. The framework-free half
 * already lives in `./skill-editor` (`SkillDraft`, `skillTemplate`,
 * `emptySkillDraft`, `draftFromSkill`, `skillSlug`, `skillDraftError`,
 * `MAX_SKILL_BYTES`), so this file is the sheet alone — the "split module" this
 * tree records in `docs/ARCHITECTURE.md`.
 *
 * The decisions that are not mechanical:
 *
 * 1. **`portalOverlay(..)` is `<Teleport :to="overlayRoot()">`.** The sheet is
 *     mounted on the viewport-fixed `#dcode-overlays` host so a
 *     transformed ancestor cannot trap `position: fixed`; `lib/overlay-root.ts`
 *     is the same host, and `ProjectCreateDialog.vue` / `SessionRenameDialog.vue`
 *     already teleport there.
 * 2. **The local `ManagementScope` component is inlined.** It was declared
 *     in this module and used once; an SFC holds one component, so its markup
 *     sits in the template where it was rendered, the way `ToolDetails.vue`
 *     inlines `FileList` / `MatchList`.
 *  3. **`useEffect` Escape handler is `onMounted` / `onUnmounted`.** The listener
 *     re-bound on `[saving, onClose]`; here it is installed once and
 *     reads the current `saving` from a ref, so the binding cannot go stale.
 *  4. **`autoFocus={!editing}` is a function ref.** The node was focused when
 *     it was inserted, without writing an `autofocus` attribute. A Vue function
 *     ref runs on every patch, so focusing unconditionally would drag focus back
 *     on each re-render; tracking the attached element focuses once per
 *     insertion, exactly as `MessageRow.vue` and `SearchDialog.vue` do.
 *  5. **The `on` / `is-over` / `is-near` modifiers are object `:class` bindings**
 *     so the class-name contract reads them as literal names instead of the
 *     glued fragments a template literal would produce.
 *
 * The utility class names are copied verbatim from the markup; the
 * hand-written partials under `src/renderer/styles/` never defined them, so they
 * are allowlisted for this file in `tests/helpers/class-contract.mjs`.
 */
import { computed, onMounted, onUnmounted, ref, type ComponentPublicInstance } from "vue";
import { useI18n } from "vue-i18n";
import type { AgentCapabilityLevel, UserSkillRecord } from "@dcode/shared";
import { overlayRoot } from "../../lib/overlay-root";
import { IconFolderOpen, IconX } from "../../lib/icons";
import Button from "../ui/Button.vue";
import Field from "../ui/Field.vue";
import Input from "../ui/Input.vue";
import Textarea from "../ui/Textarea.vue";
import HelpIcon from "../ui/HelpIcon.vue";
import TooltipButton from "../TooltipButton.vue";
import { MAX_SKILL_BYTES, skillDraftError, skillSlug, skillTemplate, type SkillDraft } from "./skill-editor";

const props = withDefaults(
  defineProps<{
    draft: SkillDraft;
    editing: UserSkillRecord | null;
    saving: boolean;
    level: AgentCapabilityLevel;
    projectName?: string;
  }>(),
  { projectName: undefined },
);

const emit = defineEmits<{
  "update:draft": [draft: SkillDraft];
  close: [];
  save: [];
  reveal: [];
}>();

const { t } = useI18n();

const nameTouched = ref(Boolean(props.editing));
const errorKey = computed(() => skillDraftError(props.draft));
// The starter document means a new skill draft is never empty; what makes it
// pristine is that the parts only the user can write are still blank.
const pristine = computed(
  () => !props.editing && !props.draft.name.trim() && !props.draft.description.trim(),
);
const bytes = computed(() => new TextEncoder().encode(props.draft.body).length);
const slug = computed(() => props.draft.id || skillSlug(props.draft.name));

/** The scope label and hint, owned by Settings rather than offered here. */
const scopeLabel = computed(() =>
  props.level === "global"
    ? t("settings.globalScope")
    : t("settings.projectScope", {
        project: props.projectName || t("settings.currentProject"),
      }),
);
const scopeHint = computed(() =>
  props.level === "global"
    ? t("settings.globalScopeDescription")
    : t("settings.projectScopeDescription"),
);

/**
 * See note 4. A Vue function ref fires on every patch, so the element identity is
 * tracked and the focus happens once per insertion; the unmount call passes
 * `null`, so re-opening the sheet focuses the field again.
 */
let focusedName: HTMLInputElement | null = null;
function focusName(element: Element | ComponentPublicInstance | null) {
  const node =
    element instanceof HTMLInputElement
      ? element
      : ((element as ComponentPublicInstance | null)?.$el as unknown);
  if (!(node instanceof HTMLInputElement)) {
    focusedName = null;
    return;
  }
  if (focusedName === node) return;
  focusedName = node;
  node.focus();
}

function set<K extends keyof SkillDraft>(key: K, value: SkillDraft[K]): void {
  emit("update:draft", { ...props.draft, [key]: value });
}

// Naming a new skill seeds the body once, so the editor is never a blank page
// but never overwrites something the user has started writing either.
function setName(value: string): void {
  const next: SkillDraft = { ...props.draft, name: value };
  if (!nameTouched.value && !props.editing && !props.draft.body.trim()) {
    next.body = skillTemplate(value);
  }
  emit("update:draft", next);
}

function toggleEnabled(): void {
  emit("update:draft", { ...props.draft, enabled: !props.draft.enabled });
}

/*
  See note 3: one listener for the sheet's lifetime, reading the live `saving`
  ref so an in-flight save cannot be escaped past.
*/
function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape" && !props.saving) emit("close");
}
onMounted(() => window.addEventListener("keydown", onKeyDown));
onUnmounted(() => window.removeEventListener("keydown", onKeyDown));

function onOverlayMouseDown(event: MouseEvent): void {
  if (event.target === event.currentTarget && !props.saving) emit("close");
}
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
        aria-labelledby="skill-sheet-title"
      >
        <div class="ext-sheet-head">
          <div>
            <h3 id="skill-sheet-title" class="ext-sheet-title">
              {{
                editing
                  ? t("extensions.skills.editTitle")
                  : t("extensions.skills.addTitle")
              }}
            </h3>
            <p class="ext-sheet-sub">{{ t("extensions.skills.sheetSubtitle") }}</p>
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
          <Field
            :label="t('extensions.skills.name')"
            :hint="
              slug
                ? t('extensions.skills.slugHint', { id: slug })
                : t('extensions.skills.nameHint')
            "
          >
            <Input
              :ref="focusName"
              :value="draft.name"
              :placeholder="t('extensions.skills.namePlaceholder')"
              @input="
                nameTouched = true;
                setName(($event.target as HTMLInputElement).value);
              "
            />
          </Field>

          <Field
            :label="t('extensions.skills.description')"
            :hint="t('extensions.skills.descriptionHint')"
          >
            <Textarea
              :value="draft.description"
              :rows="2"
              :placeholder="t('extensions.skills.descriptionPlaceholder')"
              @input="set('description', ($event.target as HTMLTextAreaElement).value)"
            />
          </Field>

          <div class="ext-field-group">
            <div class="ext-field-label ext-field-label-row">
              <span>
                {{ t("extensions.skills.body") }}
                <HelpIcon :label="t('extensions.skills.bodyHint')" />
              </span>
              <span
                class="ext-byte-count"
                :class="{
                  'is-over': bytes > MAX_SKILL_BYTES,
                  'is-near': bytes <= MAX_SKILL_BYTES && bytes > MAX_SKILL_BYTES * 0.8,
                }"
              >
                {{
                  t("extensions.skills.bytes", {
                    used: Math.round(bytes / 1024),
                    max: Math.round(MAX_SKILL_BYTES / 1024),
                  })
                }}
              </span>
            </div>
            <Textarea
              class="ext-skill-body"
              :value="draft.body"
              :rows="14"
              :spellcheck="false"
              :placeholder="skillTemplate('')"
              :aria-label="t('extensions.skills.body')"
              @input="set('body', ($event.target as HTMLTextAreaElement).value)"
            />
          </div>

          <div class="ext-field-group">
            <div class="ext-field-label">
              {{ t("settings.scope") }}
              <HelpIcon :label="t('settings.scopeHint')" />
            </div>
 <!-- the local `ManagementScope`; see note 2. -->
            <div class="agent-mcp-scope">
              <div class="agent-mcp-scope-copy">
                <span class="agent-mcp-scope-label">
                  {{ scopeLabel }}
                  <HelpIcon :label="scopeHint" />
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
                @click="toggleEnabled"
              >
                <span class="settings-toggle-thumb" />
              </button>
            </div>
          </div>
        </div>

        <p v-if="errorKey && !pristine" class="ext-sheet-error">{{ t(errorKey) }}</p>
        <div class="ext-sheet-actions">
          <Button v-if="editing" variant="ghost" @click="emit('reveal')">
            <IconFolderOpen :size="13" />
            {{ t("extensions.skills.reveal") }}
          </Button>
          <span v-else class="ext-sheet-note">{{ t("extensions.skills.sheetNote") }}</span>
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
