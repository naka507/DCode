<script setup lang="ts">
/**
 * Agent subagents settings page.
 *
 * The `AgentSubagentsPage` component.
 * The page lists two sources — the shipped defaults `Task` offers and the
 * subagent documents the user owns at the global level — in the same panel, and
 * the two groups differ in exactly one way: a builtin has no document to delete,
 * so it only offers Copy as mine and its switch.
 *
 * The decisions that are not mechanical:
 *
 *  1. **The row render functions become one `computed` of row view models.**
 *     The `renderBuiltin` / `renderRow` computed `busy`, `canCopy`,
 *     `menuOpen` and the overflow-menu item list inside the JSX map callback. A
 *     Vue template cannot declare locals per iteration, so those derivations
 *     live in `builtinRows` / `ownedRows`, the way `pages/ProjectsPage.vue`
 *     derives its per-row values in one pass. The menu items keep their
 *     shapes: `CapabilityMenuItem.icon` is the icon *component*, which
 *     `CapabilityRowMenu` renders in the same 14px box every call site used.
 *  2. **`onOpenChange` is the `open-change` emit** of `CapabilityRowMenu`, and
 *     the page's handler is shared by both groups.
 *  3. **The store read is `store.appState?.showToast`.** `showToast` is reached
 *     through the shallow-ref payload, never `store.getState()`.
 *  4. **`onClose` / `onSave` / `onReveal` are the sheet's `close` / `save` /
 *     `reveal` emits, and `setDraft` is `update:draft`.** `onReveal` is
 *     optional (the sheet renders the button only while editing), so
 *     the handler no-ops when there is nothing being edited rather than relying
 *     on the child's own guard.
 *  5. **`t(key, "Fallback")` is `t(key)`** — every key ships in the catalogs —
 *     and bare `aria-hidden` is written `aria-hidden="true"`, which is what
 *     a bare attribute cannot express.
 *  6. The capability primitives are imported one file at a time, and the
 *     framework-free half (`matchesCapabilitySearch`) from
 *     `./agent-capability-layout`, which is where this tree keeps the helpers
 *     `AgentCapabilityLayout.vue` exports.
 *
 * `agent-subagents-page` is the root modifier the stylesheet never
 * defined either; it is carried over so the reference DOM matches, and needs a
 * `CLASS_ALLOWLIST` entry in `tests/helpers/class-contract.mjs`.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { SubagentDefinition, UserSubagentRecord } from "@dcode/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { useHostCollection } from "../../hooks/use-host-collection";
import {
  IconBot,
  IconCopy,
  IconFolderOpen,
  IconPencil,
  IconPlus,
  IconTrash,
} from "../../lib/icons";
import TooltipButton from "../TooltipButton.vue";
import {
  AgentCapabilityPage,
  CapabilityButton,
  CapabilityEmpty,
  CapabilityGroupHeader,
  CapabilityPanel,
  CapabilityRow,
  CapabilityRowMenu,
  CapabilityToggle,
  CapabilityToolbar,
  matchesCapabilitySearch,
  useArmedDelete,
  type CapabilityMenuItem,
} from "./AgentCapabilityLayout.vue";
import SubagentEditorSheet, {
  draftFromDefinition,
  draftFromRecord,
  emptySubagentDraft,
  mergeSubagentToolGrant,
  subagentPresetCopyKey,
  type SubagentDraft,
} from "./SubagentEditorSheet.vue";
import {
  EMPTY_SUBAGENT_PAGE,
  fetchSubagentPageData,
  type BuiltinSubagentRow,
} from "./subagent-settings";
import type { ToastOptions } from "../../stores/app-state";

const GLOBAL_SUBAGENTS_PATH = "~/.agents/subagents";

type SubagentEditorState = {
  draft: SubagentDraft;
  editing: UserSubagentRecord | null;
  /** Selected template chip; set when Copy as mine pre-fills a builtin. */
  presetId?: string;
};

/** One builtin, flattened for the template. */
type BuiltinRow = {
  key: string;
  handle: string;
  name: string;
  enabled: boolean;
  busy: boolean;
  canCopy: boolean;
  description: string;
  tools: string[];
  definition: BuiltinSubagentRow;
};

/** One owned subagent, with the overflow-menu items it renders. */
type OwnedRow = {
  key: string;
  name: string;
  enabled: boolean;
  busy: boolean;
  menuOpen: boolean;
  description: string;
  tools: string[];
  items: CapabilityMenuItem[];
  subagent: UserSubagentRecord;
};

const { t } = useI18n();
const store = useAppStore();

const { data, setData, loading, refreshing, reload } = useHostCollection(
  fetchSubagentPageData,
  EMPTY_SUBAGENT_PAGE,
  (error) => showToast(error instanceof Error ? error.message : String(error), { variant: "error" }),
);

const owned = computed(() => data.value.owned);
const builtins = computed(() => data.value.builtins);

const search = ref("");
const busyId = ref<string | null>(null);
const menuFor = ref<string | null>(null);
const editor = ref<SubagentEditorState | null>(null);
const saving = ref(false);
const { armed, setArmed } = useArmedDelete();

/** The handles the user already owns, so a builtin stops offering Copy as mine. */
const ownedHandles = computed(() => new Set(owned.value.map((row) => row.id)));

function showToast(message: string, options?: ToastOptions) {
  store.appState?.showToast(message, options);
}

/** The localized name of a builtin, falling back to its handle. */
function builtinDisplayName(id: string): string {
  const key = subagentPresetCopyKey(id, "name");
  return key ? t(key) : id;
}

/**
 * The switch flips locally first and only reverts if the host refuses, so one
 * row's request never blanks the list or freezes the others.
 */
async function toggle(subagent: UserSubagentRecord) {
  if (busyId.value === subagent.id) return;
  const next = !subagent.enabled;
  busyId.value = subagent.id;
  setData((current) => ({
    ...current,
    owned: current.owned.map((row) =>
      row.id === subagent.id ? { ...row, enabled: next } : row,
    ),
  }));
  try {
    await api.setUserSubagentEnabled(subagent.id, next);
    showToast(
      t(next ? "settings.capabilityEnabled" : "settings.capabilityDisabled", {
        name: subagent.name || subagent.id,
      }),
      { variant: "success" },
    );
  } catch (error) {
    setData((current) => ({
      ...current,
      owned: current.owned.map((row) =>
        row.id === subagent.id ? { ...row, enabled: subagent.enabled } : row,
      ),
    }));
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    busyId.value = null;
  }
}

/**
 * A builtin has no document to switch, so its handle is stored in app-local
 * state instead — but it is the same switch: flip locally first, call the
 * host, and revert the row only if the host refuses.
 */
async function toggleBuiltin(builtin: BuiltinSubagentRow) {
  const handle = builtin.name;
  if (busyId.value === `builtin:${handle}`) return;
  const next = !builtin.enabled;
  busyId.value = `builtin:${handle}`;
  setData((current) => ({
    ...current,
    builtins: current.builtins.map((row) =>
      row.name === handle ? { ...row, enabled: next } : row,
    ),
  }));
  try {
    await api.setBuiltinSubagentEnabled(handle, next);
    showToast(
      t(next ? "settings.capabilityEnabled" : "settings.capabilityDisabled", {
        name: builtinDisplayName(handle),
      }),
      { variant: "success" },
    );
  } catch (error) {
    setData((current) => ({
      ...current,
      builtins: current.builtins.map((row) =>
        row.name === handle ? { ...row, enabled: builtin.enabled } : row,
      ),
    }));
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    busyId.value = null;
  }
}

async function openEdit(subagent: UserSubagentRecord) {
  busyId.value = subagent.id;
  try {
    const result = await api.readUserSubagent(subagent.id);
    editor.value = {
      draft: draftFromRecord(result.subagent ?? subagent, result.body ?? ""),
      editing: result.subagent ?? subagent,
    };
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    busyId.value = null;
  }
}

function copyBuiltin(definition: SubagentDefinition) {
  editor.value = {
    draft: draftFromDefinition(definition),
    editing: null,
    presetId: definition.name,
  };
}

async function save() {
  const current = editor.value;
  if (!current) return;
  const { draft, editing } = current;
  const payload = {
    name: draft.name.trim(),
    description: draft.description.trim(),
    body: draft.body,
    tools: mergeSubagentToolGrant(draft.inheritTools, draft.tools),
    // An empty string clears a pinned model; omitting it would keep the old one.
    model: draft.model.trim(),
    fallbackModels: draft.fallbackModels.map((pin: string) => pin.trim()),
    thinkingLevel: draft.thinkingLevel,
    // `0` clears the output cap, so the delegate follows the model again.
    maxTokens: draft.maxTokens,
    enabled: draft.enabled,
    scope: draft.scope,
  };
  saving.value = true;
  try {
    if (editing) await api.updateUserSubagent(editing.id, payload);
    else await api.createUserSubagent(payload);
    await reload();
    showToast(
      t(editing ? "settings.subagentSaved" : "settings.subagentCreated", {
        name: payload.name,
      }),
      { variant: "success" },
    );
    editor.value = null;
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    saving.value = false;
  }
}

async function reveal(subagent: UserSubagentRecord) {
  try {
    await api.revealSubagent({ id: subagent.id, path: subagent.path });
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  }
}

async function remove(subagent: UserSubagentRecord) {
  busyId.value = subagent.id;
  try {
    await api.removeUserSubagent(subagent.id);
    await reload();
    showToast(t("settings.capabilityDeleted", { name: subagent.name || subagent.id }), {
      variant: "success",
    });
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    busyId.value = null;
    setArmed(null);
  }
}

const visibleOwned = computed(() =>
  owned.value.filter((subagent) =>
    matchesCapabilitySearch(search.value, subagent.name, subagent.id, subagent.description),
  ),
);

const visibleBuiltins = computed(() =>
  builtins.value.filter((definition) =>
    matchesCapabilitySearch(
      search.value,
      builtinDisplayName(definition.name),
      definition.name,
      definition.description,
    ),
  ),
);

const builtinRows = computed<BuiltinRow[]>(() =>
  visibleBuiltins.value.map((definition) => {
    const handle = definition.name;
    const name = builtinDisplayName(handle);
    return {
      key: `builtin:${handle}`,
      handle,
      name,
      enabled: definition.enabled,
      busy: busyId.value === `builtin:${handle}`,
      canCopy: !ownedHandles.value.has(handle),
      description: definition.description || t("settings.noCapabilityDescription"),
      tools: definition.tools ?? [],
      definition,
    };
  }),
);

const ownedRows = computed<OwnedRow[]>(() =>
  visibleOwned.value.map((subagent) => {
    const name = subagent.name || subagent.id;
    const busy = busyId.value === subagent.id;
    const isArmed = armed.value === subagent.id;
    const items: CapabilityMenuItem[] = [
      {
        key: "reveal",
        label: t("extensions.subagents.reveal"),
        icon: IconFolderOpen,
        onSelect: () => {
          menuFor.value = null;
          void reveal(subagent);
        },
      },
      {
        key: "remove",
        label: isArmed
          ? t("settings.capabilityRemoveConfirm")
          : t("extensions.subagents.remove"),
        icon: IconTrash,
        danger: true,
        onSelect: () => {
          if (isArmed) {
            menuFor.value = null;
            void remove(subagent);
          } else {
            setArmed(subagent.id);
          }
        },
      },
    ];
    return {
      key: subagent.id,
      name,
      enabled: subagent.enabled,
      busy,
      menuOpen: menuFor.value === subagent.id,
      description: subagent.description || t("settings.noCapabilityDescription"),
      tools: subagent.tools ?? [],
      items,
      subagent,
    };
  }),
);

const searching = computed(() => Boolean(search.value.trim()));
const noMatches = computed(
  () => searching.value && visibleOwned.value.length === 0 && visibleBuiltins.value.length === 0,
);
const showOwnedGroup = computed(() => !searching.value || visibleOwned.value.length > 0);

function openCreate() {
  editor.value = { draft: emptySubagentDraft(), editing: null };
}

function setEditorDraft(draft: SubagentDraft) {
  if (editor.value) editor.value = { ...editor.value, draft };
}

function closeEditor() {
  if (!saving.value) editor.value = null;
}

/** `onReveal` is `undefined` while creating; the same guard here. */
function revealEditing() {
  const subagent = editor.value?.editing;
  if (subagent) void reveal(subagent);
}

/** One shared `onOpenChange`: only one row's menu can be open, and a close disarms. */
function setMenuOpen(key: string, open: boolean) {
  menuFor.value = open ? key : null;
  if (!open) setArmed(null);
}
</script>

<template>
  <AgentCapabilityPage class="agent-subagents-page">
    <template #toolbar>
      <CapabilityToolbar
        :search="search"
        :search-placeholder="t('extensions.subagents.searchPlaceholder')"
        @search-change="search = $event"
      >
        <template #actions>
          <CapabilityButton variant="primary" @click="openCreate">
            <IconPlus :size="14" />
            {{ t("extensions.subagents.add") }}
          </CapabilityButton>
        </template>
      </CapabilityToolbar>
    </template>

    <CapabilityPanel
      :loading="loading"
      :refreshing="refreshing"
      :loading-label="t('settings.loadingCapabilities')"
    >
      <CapabilityEmpty v-if="noMatches" :message="t('settings.capabilityNoMatches')">
        <template #icon>
          <IconBot :size="18" />
        </template>
      </CapabilityEmpty>

      <template v-else>
        <template v-if="builtinRows.length > 0">
          <CapabilityGroupHeader
            :label="t('extensions.subagents.sourceBuiltin')"
            :count="builtinRows.length"
          />
          <CapabilityRow
            v-for="row in builtinRows"
            :key="row.key"
            :name="row.name"
            :off="!row.enabled"
            :command="t('extensions.subagents.handle', { name: row.handle })"
            :description="row.description"
          >
            <template #glyph>
              <IconBot :size="16" />
            </template>
            <template #badges>
              <span class="agent-capability-badge">
                {{ t("extensions.subagents.sourceBuiltin") }}
              </span>
            </template>
            <template v-if="row.tools.length" #meta>
              <code v-for="tool in row.tools" :key="tool">{{ tool }}</code>
            </template>
            <template #actions>
              <TooltipButton
                v-if="row.canCopy"
                as="button"
                type="button"
                class="settings-icon-button"
                :label="t('extensions.subagents.copy')"
                @click="copyBuiltin(row.definition)"
              >
                <IconCopy :size="15" />
              </TooltipButton>
              <CapabilityToggle
                :checked="row.enabled"
                :busy="row.busy"
                :label="t('settings.toggleCapability', { name: row.name })"
                @change="void toggleBuiltin(row.definition)"
              />
            </template>
          </CapabilityRow>
        </template>

        <template v-if="showOwnedGroup">
          <CapabilityGroupHeader
            :label="t('settings.globalLevel')"
            :path="GLOBAL_SUBAGENTS_PATH"
            :count="visibleOwned.length"
          />
          <CapabilityEmpty
            v-if="ownedRows.length === 0"
            :message="t('settings.subagentsEmpty')"
          >
            <template #icon>
              <IconBot :size="18" />
            </template>
            <template #action>
              <CapabilityButton variant="primary" @click="openCreate">
                <IconPlus :size="14" />
                {{ t("extensions.subagents.add") }}
              </CapabilityButton>
            </template>
          </CapabilityEmpty>
          <CapabilityRow
            v-for="row in ownedRows"
            v-else
            :key="row.key"
            :name="row.name"
            :off="!row.enabled"
            :menu-open="row.menuOpen"
            :description="row.description"
          >
            <template #glyph>
              <IconBot :size="16" />
            </template>
            <template #badges>
              <span class="agent-capability-badge">{{ t("settings.globalOnly") }}</span>
            </template>
            <template v-if="row.tools.length" #meta>
              <code v-for="tool in row.tools" :key="tool">{{ tool }}</code>
            </template>
            <template #actions>
              <TooltipButton
                as="button"
                type="button"
                class="settings-icon-button"
                :aria-label="t('extensions.subagents.rowActions', { name: row.name })"
                :label="t('extensions.subagents.edit')"
                :disabled="row.busy"
                @click="void openEdit(row.subagent)"
              >
                <IconPencil :size="15" />
              </TooltipButton>
              <CapabilityRowMenu
                :label="t('extensions.subagents.rowActions', { name: row.name })"
                :items="row.items"
                :disabled="row.busy"
                :open="row.menuOpen"
                @open-change="setMenuOpen(row.key, $event)"
              />
              <CapabilityToggle
                :checked="row.enabled"
                :busy="row.busy"
                :label="t('settings.toggleCapability', { name: row.name })"
                @change="void toggle(row.subagent)"
              />
            </template>
          </CapabilityRow>
        </template>
      </template>
    </CapabilityPanel>

    <SubagentEditorSheet
      v-if="editor"
      :draft="editor.draft"
      :editing="editor.editing"
      :initial-preset-id="editor.presetId"
      :saving="saving"
      @update:draft="setEditorDraft"
      @close="closeEditor"
      @save="void save()"
      @reveal="revealEditing"
    />
  </AgentCapabilityPage>
</template>
