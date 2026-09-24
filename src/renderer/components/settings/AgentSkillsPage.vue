<script setup lang="ts">
/**
 * Agent skills settings page.
 *
 * The `AgentSkillsPage` component.
 * Skills are the one capability that exists at two levels at once, so the page
 * fetches both: the global registry and the selected project's folder. The
 * filter only decides which groups are drawn — a new skill still lands at the
 * filtered level, and the project picker decides what "project" means.
 *
 * The decisions that are not mechanical:
 *
 *  1. **The row render function becomes one `computed` of row view models.**
 *     The `renderRow` derived `busy` / `isArmed` / `menuOpen` and the
 *     overflow-menu item list inside the JSX map callback; a Vue template cannot
 *     declare locals per iteration, so `rows` derives them once, the way
 *     `pages/ProjectsPage.vue` does. `CapabilityMenuItem.icon` is the icon
 *     *component*, which `CapabilityRowMenu` renders in the same 14px box.
 *  2. **`fetchSkills` reads the live project ref, so a project change reloads.** The
 *     `useCallback` re-created the fetcher and its effect re-ran;
 *     `useHostCollection` here is a mount fetch, so the page watches
 *     `selectedProjectPath` and reloads explicitly.
 *  3. **`onXxx` props become emits.** `CapabilityToolbar` takes
 *     `filter-change` / `search-change`, `AgentProjectPicker` takes `change`,
 *     `CapabilityRowMenu` takes `open-change`, and `SkillEditorSheet` takes
 *     `update:draft` / `close` / `save` / `reveal` (the `setDraft` /
 *     `onClose` / `onSave` / `onReveal`). A child's `emit()` is only reached by
 *     a listener, so `:on-close="fn"` would silently do nothing.
 *  4. **The store read is `store.appState?.showToast`**, the tracked form of
 *     the `useAppStore((state) => state.showToast)`.
 *  5. **`t(key, "Fallback")` is `t(key)`** — every key ships in the catalogs —
 *     and bare `aria-hidden` is written `aria-hidden="true"`.
 *  6. The capability primitives are imported one file at a time, and the
 *     framework-free half (`matchesCapabilitySearch`, `projectDisplayName`,
 *     `useAgentProjects`) from `./agent-capability-layout`, where this tree
 *     keeps the helpers `AgentCapabilityLayout.vue` exports.
 *
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  GLOBAL_SCOPE,
  type AgentCapabilityLevel,
  type UserSkillRecord,
} from "@dcode/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import type { ToastOptions } from "../../stores/app-state";
import { useArmedDelete } from "../../hooks/use-armed-delete";
import { useHostCollection } from "../../hooks/use-host-collection";
import {
  IconArrowUpDown,
  IconBookOpen,
  IconCopy,
  IconDownload,
  IconFileText,
  IconFolderOpen,
  IconPencil,
  IconPlus,
  IconTrash,
} from "../../lib/icons";
import TooltipButton from "../TooltipButton.vue";
import {
  AgentCapabilityPage,
  AgentProjectPicker,
  CapabilityButton,
  CapabilityEmpty,
  CapabilityGroupHeader,
  CapabilityPanel,
  CapabilityRow,
  CapabilityRowMenu,
  CapabilityToggle,
  CapabilityToolbar,
  matchesCapabilitySearch,
  projectDisplayName,
  useAgentProjects,
  type CapabilityFilter,
  type CapabilityMenuItem,
} from "./AgentCapabilityLayout.vue";
import SkillEditorSheet from "./SkillEditorSheet.vue";
import { draftFromBuiltin, draftFromSkill, emptySkillDraft, type SkillDraft } from "./skill-editor";

const GLOBAL_SKILLS_PATH = "~/.agents/skills";

/** Where the project level's folder lives, spelled out when no project is open. */
function projectSkillsPath(projectPath: string | null): string {
  return projectPath ? `${projectPath}/.agents/skills` : "<project-root>/.agents/skills";
}

type SkillEditorState = {
  draft: SkillDraft;
  editing: UserSkillRecord | null;
  level: AgentCapabilityLevel;
};

export type BuiltinSkillItem = {
  id: string;
  name: string;
  description: string;
  body: string;
  pluginWorkspaceOnly?: boolean;
};

type SkillCollection = {
  global: UserSkillRecord[];
  project: UserSkillRecord[];
  builtins: BuiltinSkillItem[];
};

const EMPTY_SKILL_COLLECTION: SkillCollection = { global: [], project: [], builtins: [] };

/** One skill, flattened for the template. */
type SkillRow = {
  key: string;
  name: string;
  enabled: boolean;
  busy: boolean;
  menuOpen: boolean;
  description: string;
  imported: boolean;
  level: AgentCapabilityLevel;
  items: CapabilityMenuItem[];
  skill: UserSkillRecord;
};

const { t } = useI18n();
const store = useAppStore();
const { selectedProjectPath, setSelectedProjectPath, options } = useAgentProjects();

const { data, setData, loading, refreshing, reload } = useHostCollection(
  async (): Promise<SkillCollection> => {
    const projectPath = selectedProjectPath.value;
    const [global, project, builtins] = await Promise.all([
      api.listUserSkills({
        level: "global",
        ...(projectPath ? { projectPath } : {}),
      }),
      projectPath
        ? api.listUserSkills({ level: "project", projectPath })
        : Promise.resolve({ skills: [] as UserSkillRecord[] }),
      api.listBuiltinSkills().catch(() => [] as BuiltinSkillItem[]),
    ]);
    return {
      global: global.skills ?? [],
      project: project.skills ?? [],
      builtins: builtins ?? [],
    };
  },
  EMPTY_SKILL_COLLECTION,
  (error) => showToast(error instanceof Error ? error.message : String(error), { variant: "error" }),
);

// See note 2: the fetch reads the project ref, so the project changing has to
// trigger the reload that the `useCallback` dependency did.
watch(selectedProjectPath, () => void reload());

const globalSkills = computed(() => data.value.global);
const projectSkills = computed(() => data.value.project);

const filter = ref<CapabilityFilter>("all");
const search = ref("");
const busyId = ref<string | null>(null);
const menuFor = ref<string | null>(null);
const saving = ref(false);
const editor = ref<SkillEditorState | null>(null);
const { armed, setArmed } = useArmedDelete();

function showToast(message: string, options?: ToastOptions) {
  store.appState?.showToast(message, options);
}

/** A row's identity: the same id can exist at both levels. */
function rowKey(level: AgentCapabilityLevel, id: string): string {
  return `${level}:${id}`;
}

function patchRow(level: AgentCapabilityLevel, id: string, patch: Partial<UserSkillRecord>) {
  setData((current) => ({
    ...current,
    [level]: current[level].map((row) => (row.id === id ? { ...row, ...patch } : row)),
  }));
}

function levelQuery(level: AgentCapabilityLevel) {
  return {
    level,
    ...(selectedProjectPath.value ? { projectPath: selectedProjectPath.value } : {}),
  };
}

/**
 * The switch flips locally first and only reverts if the host refuses, so one
 * row's request never blanks the list or freezes the others.
 */
async function toggle(skill: UserSkillRecord, level: AgentCapabilityLevel) {
  const key = rowKey(level, skill.id);
  if (busyId.value === key) return;
  const next = !skill.enabled;
  busyId.value = key;
  patchRow(level, skill.id, { enabled: next });
  try {
    await api.setUserSkillEnabled(skill.id, next, levelQuery(level));
    showToast(
      t(next ? "settings.capabilityEnabled" : "settings.capabilityDisabled", {
        name: skill.name || skill.id,
      }),
      { variant: "success" },
    );
  } catch (error) {
    patchRow(level, skill.id, { enabled: skill.enabled });
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    busyId.value = null;
  }
}

/** Where a new or imported skill lands: the filtered level, global when both. */
const targetLevel = computed<AgentCapabilityLevel>(() =>
  filter.value === "project" ? "project" : "global",
);

function openCreate() {
  if (targetLevel.value === "project" && !selectedProjectPath.value) {
    showToast(t("settings.selectProjectFirst"), { variant: "error" });
    return;
  }
  editor.value = {
    draft: {
      ...emptySkillDraft(),
      scope:
        targetLevel.value === "global"
          ? GLOBAL_SCOPE
          : { mode: "projects", projects: [selectedProjectPath.value!] },
    },
    editing: null,
    level: targetLevel.value,
  };
}

async function openEdit(skill: UserSkillRecord, level: AgentCapabilityLevel) {
  busyId.value = rowKey(level, skill.id);
  try {
    const result = await api.readUserSkill(skill.id, levelQuery(level));
    editor.value = {
      draft: draftFromSkill(result.skill ?? skill, result.body ?? ""),
      editing: result.skill ?? skill,
      level,
    };
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    busyId.value = null;
  }
}

async function save() {
  const current = editor.value;
  if (!current) return;
  const { draft, editing, level } = current;
  const projectPath =
    level === "project" ? selectedProjectPath.value ?? undefined : undefined;
  const payload = {
    name: draft.name.trim(),
    description: draft.description.trim(),
    body: draft.body,
    enabled: draft.enabled,
    scope: draft.scope,
    level,
    ...(projectPath ? { projectPath } : {}),
  };
  saving.value = true;
  try {
    if (editing) await api.updateUserSkill(editing.id, payload);
    else await api.createUserSkill(payload);
    await reload();
    showToast(
      t(editing ? "settings.skillSaved" : "settings.skillCreated", { name: payload.name }),
      { variant: "success" },
    );
    editor.value = null;
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    saving.value = false;
  }
}

async function reveal(skill: UserSkillRecord, level: AgentCapabilityLevel) {
  try {
    await api.revealUserSkill(skill.id, levelQuery(level));
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  }
}

async function remove(skill: UserSkillRecord, level: AgentCapabilityLevel) {
  busyId.value = rowKey(level, skill.id);
  try {
    await api.removeUserSkill(skill.id, levelQuery(level));
    await reload();
    showToast(t("settings.capabilityDeleted", { name: skill.name || skill.id }), {
      variant: "success",
    });
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    busyId.value = null;
    setArmed(null);
  }
}

async function importSkill(
  level: AgentCapabilityLevel = targetLevel.value,
  sourceKind: "file" | "dir" = "file",
) {
  if (level === "project" && !selectedProjectPath.value) {
    showToast(t("settings.selectProjectFirst"), { variant: "error" });
    return;
  }
  busyId.value = sourceKind === "dir" ? "import-dir" : "import";
  try {
    const result = await api.importUserSkill({
      level,
      sourceKind,
      ...(level === "project" && selectedProjectPath.value
        ? { projectPath: selectedProjectPath.value }
        : {}),
    });
    if (!result.canceled) {
      await reload();
      if (result.skill) {
        showToast(t("settings.skillImported", { name: result.skill.name }), {
          variant: "success",
        });
      }
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    busyId.value = null;
  }
}

export type BuiltinSkillRow = BuiltinSkillItem & {
  key: string;
};

const builtinRows = computed<BuiltinSkillRow[]>(() => {
  const match = (skill: BuiltinSkillItem) =>
    matchesCapabilitySearch(search.value, skill.name, skill.id, skill.description);
  return (data.value.builtins ?? []).filter(match).map((item) => ({
    key: `builtin:${item.id}`,
    ...item,
  }));
});

const visible = computed(() => {
  const match = (skill: UserSkillRecord) =>
    matchesCapabilitySearch(search.value, skill.name, skill.id, skill.description);
  return {
    global: globalSkills.value.filter(match),
    project: projectSkills.value.filter(match),
  };
});

const counts = computed(() => ({
  all: visible.value.global.length + visible.value.project.length + builtinRows.value.length,
  global: visible.value.global.length + builtinRows.value.length,
  project: visible.value.project.length,
}));

const projectName = computed(
  () =>
    options.value.find((project) => project.path === selectedProjectPath.value)?.name ??
    (selectedProjectPath.value ? projectDisplayName(selectedProjectPath.value) : undefined),
);

/** Where a move sends a row, named the way the toast should say it. */
const moveTargets = computed<Partial<Record<AgentCapabilityLevel, string>>>(() => ({
  global: t("settings.globalLevel"),
  project: selectedProjectPath.value
    ? `${t("settings.projectLevel")} · ${
        projectName.value ?? projectDisplayName(selectedProjectPath.value)
      }`
    : undefined,
}));

/** The label the row's own move item carries, or null when it has no destination. */
function moveLabel(level: AgentCapabilityLevel): string | null {
  const to: AgentCapabilityLevel = level === "global" ? "project" : "global";
  if (!moveTargets.value[to]) return null;
  return level === "global"
    ? t("settings.capabilityMoveToProject", {
        project: projectName.value ?? projectDisplayName(selectedProjectPath.value ?? ""),
      })
    : t("settings.capabilityMoveToGlobal");
}

/**
 * Move one row to the other level. The project picker owns the destination,
 * so the same action reads "Move into <project>" on a global row and "Move to
 * Global" on a project one.
 *
 * The host moves the document rather than copying it, and a destination that
 * already holds the id or display name renames the arriving skill, so the
 * toast reports the new name instead of pretending the id survived.
 */
async function move(skill: UserSkillRecord, level: AgentCapabilityLevel) {
  const to: AgentCapabilityLevel = level === "global" ? "project" : "global";
  const target = moveTargets.value[to];
  if (!target) {
    showToast(t("settings.selectProjectFirst"), { variant: "error" });
    return;
  }
  busyId.value = rowKey(level, skill.id);
  try {
    const result = await api.transferUserSkill({
      id: skill.id,
      from: levelQuery(level),
      to: levelQuery(to),
    });
    await reload();
    const name = skill.name || skill.id;
    const arrived = result.skill;
    showToast(
      arrived && arrived.id !== skill.id
        ? t("settings.capabilityMovedRenamed", {
            name,
            target,
            newName: arrived.name || arrived.id,
          })
        : t("settings.capabilityMoved", { name, target }),
      { variant: "success" },
    );
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
  } finally {
    busyId.value = null;
  }
}

/** The rows of one level, with the menu items each one offers. */
function rowsFor(level: AgentCapabilityLevel): SkillRow[] {
  const source = level === "global" ? visible.value.global : visible.value.project;
  return source.map((skill) => {
    const key = rowKey(level, skill.id);
    const name = skill.name || skill.id;
    const busy = busyId.value === key;
    const isArmed = armed.value === key;
    const label = moveLabel(level);
    const items: CapabilityMenuItem[] = [
      {
        key: "reveal",
        label: t("extensions.skills.reveal"),
        icon: IconFolderOpen,
        onSelect: () => {
          menuFor.value = null;
          void reveal(skill, level);
        },
      },
      /**
       * A move needs a destination, so a global row offers it only while the
       * picker names a project; a project row always has Global to go back to.
       */
      ...(label
        ? [
            {
              key: "move",
              label,
              icon: IconArrowUpDown,
              onSelect: () => {
                menuFor.value = null;
                void move(skill, level);
              },
            } satisfies CapabilityMenuItem,
          ]
        : []),
      {
        key: "remove",
        label: isArmed
          ? t("settings.capabilityRemoveConfirm")
          : t("extensions.skills.remove"),
        icon: IconTrash,
        danger: true,
        onSelect: () => {
          if (isArmed) {
            menuFor.value = null;
            void remove(skill, level);
          } else {
            setArmed(key);
          }
        },
      },
    ];
    return {
      key,
      name,
      enabled: skill.enabled,
      busy,
      menuOpen: menuFor.value === key,
      description: skill.description || t("settings.noCapabilityDescription"),
      imported: skill.source === "imported",
      level,
      items,
      skill,
    };
  });
}

const globalRows = computed(() => rowsFor("global"));
const projectRows = computed(() => rowsFor("project"));

const showGlobal = computed(() => filter.value !== "project");
const showProject = computed(() => filter.value !== "global");
const showBuiltin = computed(() => filter.value !== "project");

function copyBuiltin(item: BuiltinSkillItem) {
  editor.value = {
    draft: draftFromBuiltin(item),
    editing: null,
    level: targetLevel.value,
  };
}

const newSkillTitle = computed(() =>
  targetLevel.value === "project"
    ? t("settings.capabilityCreateInProject")
    : t("settings.capabilityCreateInGlobal"),
);

const projectImportTitle = computed(() =>
  t("settings.capabilityImportToProject"),
);
const globalImportTitle = computed(() => t("settings.capabilityImportToGlobal"));

const noMatches = computed(() => counts.value.all === 0 && Boolean(search.value.trim()));



function setEditorDraft(draft: SkillDraft) {
  if (editor.value) editor.value = { ...editor.value, draft };
}

function closeEditor() {
  if (!saving.value) editor.value = null;
}

/** `onReveal` is `undefined` while creating; the same guard here. */
function revealEditing() {
  const current = editor.value;
  if (current?.editing) void reveal(current.editing, current.level);
}

/** One shared `onOpenChange`: only one row's menu can be open, and a close disarms. */
function setMenuOpen(key: string, open: boolean) {
  menuFor.value = open ? key : null;
  if (!open) setArmed(null);
}
</script>

<template>
  <AgentCapabilityPage>
    <template #toolbar>
      <CapabilityToolbar
        :filter="filter"
        :counts="counts"
        :search="search"
        :search-placeholder="t('extensions.skills.searchPlaceholder')"
        @filter-change="filter = $event"
        @search-change="search = $event"
      >
        <template #project-picker>
          <AgentProjectPicker
            :value="selectedProjectPath"
            :options="options"
            :label="t('settings.selectProject')"
            @change="setSelectedProjectPath"
          />
        </template>
        <template #actions>
          <CapabilityButton variant="primary" :title="newSkillTitle" @click="openCreate">
            <IconPlus :size="14" />
            {{ t("settings.newSkill") }}
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
          <IconBookOpen :size="18" />
        </template>
      </CapabilityEmpty>

      <template v-else>
        <template v-if="showBuiltin && builtinRows.length > 0">
          <CapabilityGroupHeader
            :label="t('extensions.skills.sourceBuiltin')"
            :count="builtinRows.length"
          />
          <CapabilityRow
            v-for="row in builtinRows"
            :key="row.key"
            :name="row.name"
            :command="row.id"
            :description="row.description"
          >
            <template #glyph>
              <IconBookOpen :size="16" />
            </template>
            <template #badges>
              <span class="agent-capability-badge">
                {{ t("extensions.skills.sourceBuiltin") }}
              </span>
              <span v-if="row.pluginWorkspaceOnly" class="agent-capability-badge">
                dev
              </span>
            </template>
            <template #actions>
              <TooltipButton
                as="button"
                type="button"
                class="settings-icon-button"
                :label="t('extensions.skills.copy')"
                @click="copyBuiltin(row)"
              >
                <IconCopy :size="15" />
              </TooltipButton>
            </template>
          </CapabilityRow>
        </template>

        <template v-if="showGlobal">
          <CapabilityGroupHeader
            :label="t('settings.globalLevel')"
            :path="GLOBAL_SKILLS_PATH"
            :count="visible.global.length"
          >
            <template #action>
              <CapabilityButton
                :busy="busyId === 'import'"
                :title="globalImportTitle"
                @click="void importSkill('global', 'file')"
              >
                <IconDownload :size="14" />
                {{ t("settings.importSkillFile") }}
              </CapabilityButton>
              <CapabilityButton
                :busy="busyId === 'import-dir'"
                :title="globalImportTitle"
                @click="void importSkill('global', 'dir')"
              >
                <IconDownload :size="14" />
                {{ t("settings.importSkillDir") }}
              </CapabilityButton>
            </template>
          </CapabilityGroupHeader>
          <CapabilityEmpty
            v-if="globalRows.length === 0"
            :message="t('settings.skillsEmpty')"
          >
            <template #icon>
              <IconBookOpen :size="18" />
            </template>
            <template #action>
              <CapabilityButton variant="primary" @click="openCreate">
                <IconPlus :size="14" />
                {{ t("extensions.skills.add") }}
              </CapabilityButton>
            </template>
          </CapabilityEmpty>
          <CapabilityRow
            v-for="row in globalRows"
            v-else
            :key="row.key"
            :name="row.name"
            :off="!row.enabled"
            :menu-open="row.menuOpen"
            :description="row.description"
          >
            <template #glyph>
              <IconBookOpen :size="16" />
            </template>
            <template #badges>
              <span class="agent-capability-badge is-level">
                {{ t("settings.capabilityFilterGlobal") }}
              </span>
              <span v-if="row.imported" class="agent-capability-badge">
                {{ t("settings.imported") }}
              </span>
            </template>
            <template #actions>
              <TooltipButton
                as="button"
                type="button"
                class="settings-icon-button"
                :aria-label="t('extensions.skills.rowActions', { name: row.name })"
                :label="t('extensions.skills.edit')"
                :disabled="row.busy"
                @click="void openEdit(row.skill, row.level)"
              >
                <IconPencil :size="15" />
              </TooltipButton>
              <CapabilityRowMenu
                :label="t('extensions.skills.rowActions', { name: row.name })"
                :items="row.items"
                :disabled="row.busy"
                :open="row.menuOpen"
                @open-change="setMenuOpen(row.key, $event)"
              />
              <CapabilityToggle
                :checked="row.enabled"
                :busy="row.busy"
                :label="t('settings.toggleCapability', { name: row.name })"
                @change="void toggle(row.skill, row.level)"
              />
            </template>
          </CapabilityRow>
        </template>

        <template v-if="showProject">
          <CapabilityGroupHeader
            :label="t('settings.projectLevel')"
            :path="projectSkillsPath(selectedProjectPath)"
            :count="visible.project.length"
          >
            <template v-if="selectedProjectPath" #action>
              <CapabilityButton
                :busy="busyId === 'import'"
                :title="projectImportTitle"
                @click="void importSkill('project', 'file')"
              >
                <IconDownload :size="14" />
                {{ t("settings.importSkillFile") }}
              </CapabilityButton>
              <CapabilityButton
                :busy="busyId === 'import-dir'"
                :title="projectImportTitle"
                @click="void importSkill('project', 'dir')"
              >
                <IconDownload :size="14" />
                {{ t("settings.importSkillDir") }}
              </CapabilityButton>
            </template>
          </CapabilityGroupHeader>
          <CapabilityEmpty
            v-if="!selectedProjectPath"
            :message="t('settings.selectProjectFirst')"
          />
          <CapabilityEmpty
            v-else-if="projectRows.length === 0"
            :message="t('settings.skillsEmpty')"
          >
            <template #icon>
              <IconBookOpen :size="18" />
            </template>
          </CapabilityEmpty>
          <CapabilityRow
            v-for="row in projectRows"
            v-else
            :key="row.key"
            :name="row.name"
            :off="!row.enabled"
            :menu-open="row.menuOpen"
            :description="row.description"
          >
            <template #glyph>
              <IconBookOpen :size="16" />
            </template>
            <template #badges>
              <span class="agent-capability-badge is-level">
                {{ t("settings.capabilityFilterProject") }}
              </span>
              <span v-if="row.imported" class="agent-capability-badge">
                {{ t("settings.imported") }}
              </span>
            </template>
            <template #actions>
              <TooltipButton
                as="button"
                type="button"
                class="settings-icon-button"
                :aria-label="t('extensions.skills.rowActions', { name: row.name })"
                :label="t('extensions.skills.edit')"
                :disabled="row.busy"
                @click="void openEdit(row.skill, row.level)"
              >
                <IconPencil :size="15" />
              </TooltipButton>
              <CapabilityRowMenu
                :label="t('extensions.skills.rowActions', { name: row.name })"
                :items="row.items"
                :disabled="row.busy"
                :open="row.menuOpen"
                @open-change="setMenuOpen(row.key, $event)"
              />
              <CapabilityToggle
                :checked="row.enabled"
                :busy="row.busy"
                :label="t('settings.toggleCapability', { name: row.name })"
                @change="void toggle(row.skill, row.level)"
              />
            </template>
          </CapabilityRow>
        </template>
      </template>
    </CapabilityPanel>

    <SkillEditorSheet
      v-if="editor"
      :draft="editor.draft"
      :editing="editor.editing"
      :saving="saving"
      :level="editor.level"
      :project-name="projectName"
      @update:draft="setEditorDraft"
      @close="closeEditor"
      @save="void save()"
      @reveal="revealEditing"
    />
  </AgentCapabilityPage>
</template>
