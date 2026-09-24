<script setup lang="ts">
/**
 * Create/edit sheet for one user-owned MCP server.
 *
 * The transport choice comes first because it decides what the rest of the form
 * even means, and the two branches never both show: a form that asks for a URL
 * and a command at the same time invites a config that is half of each.
 *
 * framework-free half (`McpDraft`, `emptyMcpDraft`, `draftFromRecord`,
 * `splitArgs`, `mcpIdFromLabel`, `draftToInput`, `mcpDraftError`) is in
 * `./mcp-editor` and re-exported from the plain `<script>` block below, so
 * `AgentMcpPage` keeps importing every original name from this specifier.
 *
 * The design decisions that are not mechanical:
 *
 *  1. **`portalOverlay(..)` is `<Teleport :to="overlayRoot()">`.** The sheet
 *     mounts on the viewport-fixed `#dcode-overlays` host so a
 *     transformed ancestor cannot trap `position: fixed`; `lib/overlay-root.ts`
 *     is the same host and `SkillEditorSheet.vue` already teleports there.
 *  2. **`onClose` / `onSave` / `onTest` / `setDraft` are emits.** A child's
 *     `emit()` is only reached by a listener, so the callbacks become
 *     `close` / `save` / `test` / `update:draft` — the same shape the sibling
 *     `SkillEditorSheet.vue` uses (`close` / `save` / `reveal` /
 *     `update:draft`). A caller writes `@close`, `@save`, `@test`,
 *     `@update:draft`.
 *  3. **The local `ManagementScope` is inlined.** It was declared in this
 *     module and used once; an SFC holds one component, so its markup sits in
 *     the template where it was rendered, the way `SkillEditorSheet.vue` inlines
 *     its own copy.
 *  4. **The `transports` array holds components, not elements.** The icon
 *     `useMemo` built element nodes; here the two icon components are
 *     selected with `<component :is>`, so the same array shape survives without
 *     a `useMemo` (a module-level constant cannot go stale).
 *  5. **The `is-${status.state}` modifier is an object binding of literal
 *     names.** A template literal built it; the class-name contract reads a
 *     template literal's static text verbatim and would report the glued fragment
 *     `is-`.
 *     All three names it can produce have a rule in `styles/extensions.css`.
 *  6. **The Escape handler is `onMounted` / `onUnmounted`.** The
 *     listener was re-bound on `[saving, onClose]`; here it is installed
 *     once and reads the live `saving` prop, so the binding cannot go stale.
 *  7. **`aria-modal` / `aria-hidden` are explicit.** Both are written
 *     explicitly because a bare Vue attribute renders `""` rather than `"true"`.
 *  8. `t(key, "Fallback")` becomes `t(key)`: every key ships in the catalogs.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  isNonLoopbackHttpMcpUrl,
  MCP_PRESETS,
  type AgentCapabilityLevel,
  type McpPreset,
  type McpServerRecord,
  type McpServerStatus,
  type McpTransport,
  type ProjectRecord,
} from "@dcode/shared";
import { overlayRoot } from "../../lib/overlay-root";
import { IconPlay, IconServer, IconTerminal, IconX } from "../../lib/icons";
import Button from "../ui/Button.vue";
import Field from "../ui/Field.vue";
import Input from "../ui/Input.vue";
import HelpIcon from "../ui/HelpIcon.vue";
import TooltipButton from "../TooltipButton.vue";
import KeyValueRows from "./KeyValueRows.vue";
import ScopeControl from "./ScopeControl.vue";
import {
  draftFromPreset,
  mcpDraftError,
  mcpIdFromLabel,
  type McpDraft,
} from "./mcp-editor";

const props = withDefaults(
  defineProps<{
    draft: McpDraft;
    /** The record being edited, or null when creating: the id is immutable once saved. */
    editing: McpServerRecord | null;
    saving: boolean;
    status?: McpServerStatus;
    testing: boolean;
    projects: readonly ProjectRecord[];
    currentProjectPath?: string | null;
    /** When set, render the compact global/project scope instead of ScopeControl. */
    managementLevel?: AgentCapabilityLevel;
    managementProjectName?: string;
  }>(),
  {
    status: undefined,
    currentProjectPath: undefined,
    managementLevel: undefined,
    managementProjectName: undefined,
  },
);

const emit = defineEmits<{
  "update:draft": [draft: McpDraft];
  close: [];
  save: [];
  test: [];
}>();

const { t } = useI18n();

const idTouched = ref(Boolean(props.editing));
const errorKey = computed(() => mcpDraftError(props.draft));
// A form the user has not started saying "an identifier is required" scolds
// them for opening it. The message appears once there is something to correct.
const pristine = computed(
  () =>
    !props.editing &&
    !props.draft.id.trim() &&
    !props.draft.label.trim() &&
    !props.draft.command.trim() &&
    !props.draft.url.trim(),
);

/** The two transports, with the icon component for each; see note 4. */
const TRANSPORTS: ReadonlyArray<{
  id: McpTransport;
  icon: typeof IconTerminal;
  labelKey: string;
}> = [
  { id: "stdio", icon: IconTerminal, labelKey: "extensions.mcp.transportStdio" },
  { id: "http", icon: IconServer, labelKey: "extensions.mcp.transportHttp" },
];

const insecureHttp = computed(
  () =>
    props.draft.transport === "http" &&
    isNonLoopbackHttpMcpUrl(props.draft.url.trim()),
);

function set<K extends keyof McpDraft>(key: K, value: McpDraft[K]): void {
  emit("update:draft", { ...props.draft, [key]: value });
}

// Typing a name fills the id until the user takes it over, so the common path
// never asks for two spellings of the same thing.
function setLabel(value: string): void {
  if (idTouched.value) {
    emit("update:draft", { ...props.draft, label: value });
    return;
  }
  emit("update:draft", {
    ...props.draft,
    label: value,
    id: mcpIdFromLabel(value),
  });
}

const selectedPresetId = ref<string | null>(null);

const activePresetDescription = computed(() => {
  if (!selectedPresetId.value) return null;
  return MCP_PRESETS.find((p) => p.id === selectedPresetId.value)?.description ?? null;
});

function applyPreset(preset: McpPreset): void {
  selectedPresetId.value = preset.id;
  idTouched.value = true;
  emit("update:draft", draftFromPreset(preset, props.draft.scope));
}

/* See note 6: one listener for the sheet's lifetime, reading the live `saving`. */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape" && !props.saving) emit("close");
}
onMounted(() => window.addEventListener("keydown", onKeyDown));
onUnmounted(() => window.removeEventListener("keydown", onKeyDown));
function onOverlayMouseDown(event: MouseEvent): void {
  if (event.target === event.currentTarget && !props.saving) emit("close");
}

/** The local `ManagementScope` label; see note 3. */
const managementScopeLabel = computed(() =>
  props.managementLevel === "global"
    ? t("settings.globalScope")
    : t("settings.projectScope", {
        project: props.managementProjectName || t("settings.currentProject"),
      }),
);
const managementScopeHint = computed(() =>
  props.managementLevel === "global"
    ? t("settings.globalScopeHint")
    : t("settings.projectScopeHint"),
);
</script>

<script lang="ts">
/**
 * This module also carries the draft model and its conversions. `<script setup>`
 * cannot export, so the framework-free half is
 * re-exported here from `./mcp-editor` and every importer keeps the original
 * specifier.
 */
export {
  draftFromPreset,
  draftFromRecord,
  draftToInput,
  emptyMcpDraft,
  mcpDraftError,
  mcpIdFromLabel,
  splitArgs,
  type McpDraft,
} from "./mcp-editor";
export { pairsToRecord, recordToPairs, type KeyValuePair } from "./key-value-rows";
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
        aria-labelledby="mcp-sheet-title"
      >
        <div class="ext-sheet-head">
          <div>
            <h3 id="mcp-sheet-title" class="ext-sheet-title">
              {{ props.editing ? t("extensions.mcp.editTitle") : t("extensions.mcp.addTitle") }}
            </h3>
            <p class="ext-sheet-sub">
              {{
                props.managementLevel === "project" && props.managementProjectName
                  ? t("settings.mcpProjectSubtitle", { project: props.managementProjectName })
                  : t("extensions.mcp.sheetSubtitle")
              }}
            </p>
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
          <div v-if="!props.editing" class="ext-field-group">
            <div class="ext-field-label">{{ t("extensions.mcp.presetLabel") }}</div>
            <div class="ext-preset-pick" role="group" :aria-label="t('extensions.mcp.presetLabel')">
              <button
                v-for="preset in MCP_PRESETS"
                :key="preset.id"
                type="button"
                class="ext-preset-chip"
                :class="{ 'is-selected': selectedPresetId === preset.id }"
                @click="applyPreset(preset)"
              >
                <span class="ext-preset-chip-name">{{ preset.name }}</span>
              </button>
            </div>
            <p v-if="activePresetDescription" class="ext-preset-desc">
              {{ activePresetDescription }}
            </p>
          </div>

          <div class="ext-field-group">
            <div class="ext-field-label">{{ t("extensions.mcp.transport") }}</div>
            <div
              class="ext-transport-pick"
              role="radiogroup"
              :aria-label="t('extensions.mcp.transport')"
            >
              <button
                v-for="option in TRANSPORTS"
                :key="option.id"
                type="button"
                role="radio"
                :aria-checked="props.draft.transport === option.id"
                class="ext-transport-card"
                :class="{ 'is-active': props.draft.transport === option.id }"
                @click="set('transport', option.id)"
              >
                <span class="ext-transport-icon" aria-hidden="true">
                  <component :is="option.icon" :size="14" />
                </span>
                <span class="ext-transport-copy">
                  <span class="ext-transport-name">{{ t(option.labelKey) }}</span>
                </span>
              </button>
            </div>
          </div>

          <div class="ext-field-pair">
            <Field :label="t('extensions.mcp.label')">
              <Input
                :value="props.draft.label"
                :placeholder="t('extensions.mcp.labelPlaceholder')"
                @input="setLabel(($event.target as HTMLInputElement).value)"
              />
            </Field>
            <Field
              :label="t('extensions.mcp.id')"
              :hint="t('extensions.mcp.idHint')"
            >
              <Input
                :value="props.draft.id"
                :disabled="Boolean(props.editing)"
                placeholder="context7"
                @input="
                  idTouched = true;
                  set('id', ($event.target as HTMLInputElement).value);
                "
              />
            </Field>
          </div>

          <template v-if="props.draft.transport === 'stdio'">
            <Field
              :label="t('extensions.mcp.command')"
              :hint="t('extensions.mcp.commandHint')"
            >
              <Input
                :value="props.draft.command"
                placeholder="npx"
                @input="set('command', ($event.target as HTMLInputElement).value)"
              />
            </Field>
            <Field
              :label="t('extensions.mcp.args')"
              :hint="t('extensions.mcp.argsHint')"
            >
              <Input
                :value="props.draft.args"
                placeholder="-y @upstash/context7-mcp"
                @input="set('args', ($event.target as HTMLInputElement).value)"
              />
            </Field>
            <div class="ext-field-group">
              <div class="ext-field-label">
                {{ t("extensions.mcp.env") }}
                <HelpIcon :label="t('extensions.mcp.envHint')" />
              </div>
              <KeyValueRows
                :pairs="props.draft.env"
                :on-change="(next) => set('env', next)"
                key-placeholder="API_KEY"
                :value-placeholder="t('extensions.mcp.valuePlaceholder')"
                :add-label="t('extensions.mcp.addEnv')"
                secret
              />
            </div>
          </template>

          <template v-else>
            <Field
              :label="t('extensions.mcp.url')"
              :hint="t('extensions.mcp.urlHint')"
            >
              <Input
                :value="props.draft.url"
                placeholder="https://mcp.example.com/sse"
                @input="set('url', ($event.target as HTMLInputElement).value)"
              />
            </Field>
            <p v-if="insecureHttp" class="ext-sheet-warning" role="note">
              {{ t("extensions.mcp.insecureHttpWarning") }}
            </p>
            <div class="ext-field-group">
              <div class="ext-field-label">
                {{ t("extensions.mcp.headers") }}
                <HelpIcon :label="t('extensions.mcp.headersHint')" />
              </div>
              <KeyValueRows
                :pairs="props.draft.headers"
                :on-change="(next) => set('headers', next)"
                key-placeholder="Authorization"
                :value-placeholder="t('extensions.mcp.valuePlaceholder')"
                :add-label="t('extensions.mcp.addHeader')"
                secret
              />
            </div>
          </template>

          <Field :label="t('extensions.mcp.description')">
            <Input
              :value="props.draft.description"
              :placeholder="t('extensions.mcp.descriptionPlaceholder')"
              @input="set('description', ($event.target as HTMLInputElement).value)"
            />
          </Field>

          <div class="ext-field-group">
            <div class="ext-field-label">
              {{ props.managementLevel ? t("settings.scope") : t("extensions.scope.title") }}
              <HelpIcon
                :label="
                  props.managementLevel
                    ? t('settings.scopeHint')
                    : t('extensions.scope.sheetHint')
                "
              />
            </div>
            <!-- The local `ManagementScope`; see note 3. -->
            <div v-if="props.managementLevel" class="agent-mcp-scope">
              <div class="agent-mcp-scope-copy">
                <span class="agent-mcp-scope-label">
                  {{ managementScopeLabel }}
                  <HelpIcon :label="managementScopeHint" />
                </span>
              </div>
              <button
                type="button"
                class="settings-toggle"
                :class="{ on: props.draft.enabled }"
                role="switch"
                :aria-checked="props.draft.enabled"
                :aria-label="
                  t('settings.enableCapability', {
                    name: props.draft.label || props.draft.id,
                  })
                "
                @click="set('enabled', !props.draft.enabled)"
              >
                <span class="settings-toggle-thumb" />
              </button>
            </div>
            <ScopeControl
              v-else
              :target="{ enabled: props.draft.enabled, scope: props.draft.scope }"
              :label="props.draft.label || props.draft.id || t('extensions.mcp.thisServer')"
              :projects="props.projects"
              :current-project-path="props.currentProjectPath"
              @set-enabled="set('enabled', $event)"
              @set-scope="
                emit('update:draft', {
                  ...props.draft,
                  scope: $event,
                  enabled: true,
                })
              "
            />
          </div>

          <div
            v-if="props.status && props.status.state !== 'idle'"
            class="ext-test-result"
            :class="{
              'is-ready': props.status.state === 'ready',
              'is-connecting': props.status.state === 'connecting',
              'is-failed': props.status.state === 'failed',
            }"
            role="status"
          >
            <span class="ext-test-dot" aria-hidden="true" />
            <span class="ext-test-copy">
              {{
                props.status.state === "ready"
                  ? t("extensions.mcp.testReady", { count: props.status.toolCount })
                  : props.status.state === "connecting"
                    ? t("extensions.mcp.testConnecting")
                    : props.status.message || t("extensions.mcp.testFailed")
              }}
            </span>
            <span
              v-if="props.status.state === 'ready' && props.status.toolNames?.length"
              class="ext-test-tools"
            >
              {{ props.status.toolNames.join(" · ") }}
            </span>
          </div>
        </div>

        <p v-if="errorKey && !pristine" class="ext-sheet-error">{{ t(errorKey) }}</p>
        <div class="ext-sheet-actions">
          <Button
            v-if="props.editing"
            variant="ghost"
            :disabled="props.testing"
            @click="emit('test')"
          >
            <IconPlay :size="13" />
            {{ props.testing ? t("extensions.mcp.testing") : t("extensions.mcp.test") }}
          </Button>
          <span v-else class="ext-sheet-note">{{ t("extensions.mcp.testAfterSave") }}</span>
          <div class="ext-sheet-actions-end">
            <Button variant="ghost" :disabled="props.saving" @click="emit('close')">
              {{ t("common.cancel") }}
            </Button>
            <Button
              variant="primary"
              :disabled="props.saving || Boolean(errorKey)"
              :title="errorKey ? t(errorKey) : undefined"
              @click="emit('save')"
            >
              {{ props.saving ? t("common.saving") : t("common.save") }}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
