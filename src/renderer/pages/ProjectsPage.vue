<script setup lang="ts">
/**
 * Projects page — the settings → Project archive surface.
 *
 * The framework-free half is
 * `lib/project-archive.ts` (30 exports) and the two halves of the surface are
 * `features/projects/ProjectArchiveIndex.vue` and
 * `features/projects/ProjectDetailPanel.vue`. The page owns only the composition
 * of those three; the helpers live in the sibling module.
 *
 * The implementation decisions that are not mechanical:
 *
 *  1. **One open card, not a per-row `expanded` record.** The page holds a
 *     single `openPath`; a row click runs it through `nextArchiveOpenPath`, so
 *     clicking the open row closes it and any other row opens its card. There
 *     is no record letting several cards sit open at once and no per-row expand
 *     button duplicating the row click; the `.projects-row-detail` element the
 *     detail used to render into is gone. The card now lives inside the row
 *     block, in `.projects-inspector`, exactly where it belongs.
 *  2. **The index is keyboard-navigable.** `.projects-workbench` is focusable
 *     and its `onIndexKeyDown` walks the *rendered* order (section order with
 *     the active sort applied) with `neighborPath`, moving real focus with it,
 *     and Enter activates the open row. This handler is the only keyboard
 *     navigation for the index. It stays out of `.projects-inspector` so Enter on a session
 *     row or the overflow trigger remains that control's own action.
 *  3. **Store selectors become `store.appState` reads.** The ~20 store selectors
 *     are read off `store.appState` through
 *     `store.appState?.<field>` inside the handlers and `computed`, which is the
 *     tracked form. `useAppStore.getState()` inside `openProjectSession` is
 *     `store.appState?.workspace?.path` — `getState()` is deliberately absent
 *     from the store.
 *  4. **The mount fetch is a `watch` on `sessions`.** It re-lists the durable
 *     project groups whenever the session list changes, so it is a watcher with
 *     `immediate: true`, not an `onMounted` run.
 *  5. **`AnchoredMenu`'s `trigger(ref)` render prop is its `#trigger` slot.**
 *     `setAnchor` is the ref the slot hands back; `onClose` is its `close` emit.
 *  6. **`onXxx` props become emits.** The five dialogs this page owns take
 *     `close` / `saved` / `deleted` / `error` instead of callbacks.
 *  7. **`t(key, { defaultValue })` is `t(key)`.** The keys are in the shipped
 *     catalogs, so the fallback text is unreachable.
 *  8. **The per-project derivations are one `sections` computed.**
 *     `sessionCounts` and `groups` come from one derivation pass, which is
 *     the property that matters — the header totals can never disagree with the
 *     rows below them. `renderedRows` is that same pass flattened, because it is
 *     the order the arrow keys must follow.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ProjectGroupRecord } from "@dcode/shared";
import { ErrorCodes } from "@dcode/shared";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import { loadRecentProjects, type RecentProject } from "../lib/recent-projects";
import { collectSessionProjects } from "../lib/session-projects";
import { normalizeProjectPath } from "../lib/sidebar-session-groups";
import { useArmedDelete } from "../hooks/use-armed-delete";
import Button from "../components/ui/Button.vue";
import TooltipButton from "../components/TooltipButton.vue";
import AnchoredMenu from "../components/settings/AnchoredMenu.vue";
import ProjectEditDialog from "../components/ProjectEditDialog.vue";
import ProjectDeleteDialog from "../components/ProjectDeleteDialog.vue";
import ProjectInstructionsDialog from "../components/ProjectInstructionsDialog.vue";
import ProjectMemoryDialog from "../components/ProjectMemoryDialog.vue";
import SessionRenameDialog from "../components/SessionRenameDialog.vue";
import ProjectArchiveIndex from "../features/projects/ProjectArchiveIndex.vue";
import ProjectDetailPanel from "../features/projects/ProjectDetailPanel.vue";
import {
  IconArchive,
  IconArchiveRestore,
  IconChat,
  IconFileText,
  IconMore,
  IconPencil,
  IconPin,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconTrash,
  IconX,
} from "../lib/icons";
import {
  INITIAL_VISIBLE_SESSION_COUNT,
  SORT_MODES,
  buildProjectIndex,
  countProjectSessions,
  displayedProjectSessions,
  filterArchiveItems,
  groupArchiveRows,
  neighborPath,
  nextArchiveOpenPath,
  projectRowId,
  sessionMatchesIndexProject,
  type ProjectDeleteTarget,
  type ProjectDialogTarget,
  type ProjectEditTarget,
  type ProjectIndexItem,
  type SessionIndexRecord,
  type SortMode,
} from "../lib/project-archive";

const { t, locale } = useI18n();
const store = useAppStore();

const sessions = computed(() => store.appState?.sessions ?? []);
const runningSessions = computed(() => store.appState?.runningSessions ?? {});
const workspace = computed(() => store.appState?.workspace);
const openProjectPaths = computed(() => store.appState?.openProjectPaths ?? []);
const projectMeta = computed(() => store.appState?.projectMeta ?? {});

const recents = ref<RecentProject[]>(loadRecentProjects());
const durableProjects = ref<ProjectGroupRecord[]>([]);
const query = ref("");
const sort = ref<SortMode>("recent");
/* The row whose card is open. Closed until the user asks for one. */
const openPath = ref<string | null>(null);
const visibleSessionCounts = ref<Record<string, number>>({});
const menuFor = ref<string | null>(null);
/* Which row menu item is armed for its second, confirming click. */
const { armed: armedDelete, setArmed: setArmedDelete } = useArmedDelete();
const renameFor = ref<SessionIndexRecord | null>(null);
const editProjectFor = ref<ProjectEditTarget | null>(null);
const deleteFor = ref<ProjectDeleteTarget | null>(null);
const instructionsFor = ref<ProjectDialogTarget | null>(null);
const memoryFor = ref<ProjectDialogTarget | null>(null);
const searchRef = ref<HTMLInputElement | null>(null);

/** Show a failure the way every handler on this page does. */
function reportError(error: unknown) {
  store.appState?.showToast(error instanceof Error ? error.message : String(error), {
  });
}

/*
 * Session-derived entries below keep the index useful if host listing fails, so
 * a rejected `listProjectGroups` is deliberately swallowed.
 */
watch(
  sessions,
  (_value, _previous, onCleanup) => {
    let canceled = false;
    void api
      .listProjectGroups()
      .then(({ groups }) => {
        if (!canceled) durableProjects.value = groups;
      })
      .catch(() => {
        // Session-derived entries keep the index useful if host listing fails.
      });
    onCleanup(() => {
      canceled = true;
    });
  },
  { immediate: true },
);

const items = computed<ProjectIndexItem[]>(() =>
  buildProjectIndex({
    durableProjects: durableProjects.value,
    recents: recents.value,
    sessionProjects: collectSessionProjects(sessions.value),
    workspace: workspace.value,
    projectMeta: projectMeta.value,
  }),
);

const filtered = computed(() =>
  filterArchiveItems(items.value, sessions.value, query.value),
);

/* The rendered order: section order with each section's active sort applied. */
const sections = computed(() =>
  groupArchiveRows(filtered.value, sort.value, locale.value || undefined),
);

const renderedRows = computed(() => sections.value.flatMap((group) => group.rows));

/*
 * The index counts every session of every row, not just the rows of one group,
 * so a row shows the same count whether it sits in Pinned, Projects or
 * Archived. It is one pass over the sessions for the whole index, which is what
 * the shared `useMemo` produced.
 */
const sessionCounts = computed(() =>
  countProjectSessions(items.value, sessions.value as SessionIndexRecord[]),
);

/*
 * An open card cannot outlive its row: a search that no longer matches the
 * project drops it from the list, and the card closes with it.
 */
watch(filtered, (rows) => {
  if (openPath.value && !rows.some((item) => item.path === openPath.value)) {
    openPath.value = null;
  }
});

const project = computed(
  () => filtered.value.find((item) => item.path === openPath.value) ?? null,
);

const selectedSessions = computed(() =>
  project.value
    ? displayedProjectSessions(
        sessions.value as SessionIndexRecord[],
        project.value,
        query.value,
      )
    : { related: [] as SessionIndexRecord[], displayed: [], sessionSearchMatch: false },
);

const visibleCount = computed(
  () =>
    (project.value ? visibleSessionCounts.value[project.value.path] : undefined) ??
    INITIAL_VISIBLE_SESSION_COUNT,
);
const visibleSessions = computed(() =>
  selectedSessions.value.displayed.slice(0, visibleCount.value),
);
const hiddenSessionCount = computed(
  () => selectedSessions.value.displayed.length - visibleSessions.value.length,
);
const totalSessions = computed(() =>
  project.value
    ? (sessionCounts.value.get(project.value.path) ?? selectedSessions.value.related.length)
    : 0,
);
const menuOpen = computed(() => Boolean(project.value && menuFor.value === project.value.path));
const selectedActive = computed(
  () =>
    project.value != null &&
    normalizeProjectPath(workspace.value?.path) === normalizeProjectPath(project.value.path),
);
const selectedRetained = computed(
  () =>
    project.value != null &&
    openProjectPaths.value.some(
      (path) => normalizeProjectPath(path) === normalizeProjectPath(project.value!.path),
    ),
);
const selectedArchived = computed(() => project.value?.archived === true);

const searching = computed(() => query.value.trim().length > 0);

const deleteRunningSessionIds = computed(() => {
  const target = deleteFor.value;
  if (!target) return [];
  return sessions.value
    .filter(
      (session) =>
        sessionMatchesIndexProject(session, target) &&
        runningSessions.value[session.id] === true,
    )
    .map((session) => session.id);
});

async function activate(path: string): Promise<boolean> {
  try {
    const key = normalizeProjectPath(path);
    const archived = Boolean(key && projectMeta.value[key]?.archived);
    if (normalizeProjectPath(workspace.value?.path) === normalizeProjectPath(path)) {
      if (archived) store.appState?.restoreProject(path);
      store.appState?.setPage("chat");
      return true;
    }
    const activated = await store.appState?.activateProject(path);
    if (!activated) {
      store.appState?.showToast(t("project.none"), { variant: "error" });
      return false;
    }
    if (archived) store.appState?.restoreProject(path);
    recents.value = loadRecentProjects();
    return true;
  } catch (e) {
    reportError(e);
    return false;
  }
}

async function startTask(path: string) {
  try {
    const key = normalizeProjectPath(path);
    if (key && projectMeta.value[key]?.archived) store.appState?.restoreProject(path);
    await store.appState?.newSession({ projectPath: path });
    recents.value = loadRecentProjects();
    store.appState?.setPage("chat");
  } catch (e) {
    reportError(e);
  }
}

async function openProjectSession(path: string, sessionId: string) {
  if (!(await activate(path))) return;
  if (normalizeProjectPath(store.appState?.workspace?.path) !== normalizeProjectPath(path)) {
    return;
  }
  try {
    await store.appState?.selectSession(sessionId);
  } catch (e) {
    reportError(e);
  }
}

/*
 * The index is one selectable list, so the arrow keys walk it and Enter takes
 * the chat path. Selection moves real focus with it, otherwise the next arrow
 * key would keep firing from wherever the user last clicked.
 *
 * Two bounds keep the handler from stealing its own children's keys. It walks
 * the rows in rendered order — the section order and the active sort, not the
 * index build order — and it stays out of the open card entirely, so Enter on
 * a session row or the overflow trigger stays that control's own action
 * instead of being answered as "activate this project".
 */
function onIndexKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.closest(".projects-inspector")) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = neighborPath(
      renderedRows.value,
      openPath.value,
      event.key === "ArrowDown" ? 1 : -1,
    );
    if (!next || next === openPath.value) return;
    openPath.value = next;
    menuFor.value = null;
    document
      .getElementById(projectRowId(next))
      ?.querySelector<HTMLButtonElement>(".projects-row")
      ?.focus();
    return;
  }
  if (event.key === "Enter" && openPath.value) {
    event.preventDefault();
    void activate(openPath.value);
  }
}

/** Menu items of different surfaces never share an armed key. */
function projectDeleteKey(path: string) {
  return `project:${normalizeProjectPath(path)}`;
}

/**
 * Two-step delete for an index row. The first click arms the menu item and
 * relabels it; the second deletes an idle project straight away. A project with
 * a live turn keeps the dialog that names those sessions and stops them before
 * the delete.
 */
async function requestDeleteProject(item: ProjectIndexItem, total: number) {
  const key = projectDeleteKey(item.path);
  if (armedDelete.value !== key) {
    setArmedDelete(key);
    return;
  }
  setArmedDelete(null);
  menuFor.value = null;
  const liveSessions = sessions.value.filter(
    (session) =>
      sessionMatchesIndexProject(session, item) && runningSessions.value[session.id] === true,
  );
  if (liveSessions.length > 0) {
    deleteFor.value = {
      name: item.name,
      path: item.path,
      sessionCount: total,
      roots: item.roots,
    };
    return;
  }
  try {
    await store.appState?.deleteProject(item.path);
    recents.value = loadRecentProjects();
    store.appState?.showToast(t("project.deleted", { name: item.name }), {
      variant: "success",
    });
  } catch (error) {
    // The host refuses a project whose task started after this render.
    store.appState?.showToast(
      (error as { errorCode?: unknown } | null)?.errorCode === ErrorCodes.CONFLICT
        ? t("project.deleteRunningBlocked")
        : error instanceof Error
          ? error.message
          : String(error),
      { variant: "error" },
    );
  }
}

async function toggleProjectArchive(item: ProjectIndexItem) {
  menuFor.value = null;
  if (item.archived) {
    store.appState?.restoreProject(item.path);
    return;
  }
  try {
    const projectKey = normalizeProjectPath(item.path);
    const isActive = normalizeProjectPath(workspace.value?.path) === projectKey;
    if (isActive) {
      const fallbackPath = [...openProjectPaths.value].reverse().find((path) => {
        const key = normalizeProjectPath(path);
        return key !== projectKey && !(key && projectMeta.value[key]?.archived);
      });
      if (fallbackPath) {
        const activated = await store.appState?.activateProject(fallbackPath);
        if (!activated) throw new Error(t("project.none"));
        // Project management actions should keep the archive visible.
        store.appState?.setSettingsTab("projects");
      } else {
        await store.appState?.clearProject();
      }
    }
    store.appState?.archiveProject(item.path);
  } catch (error) {
    reportError(error);
  }
}

async function closeProjectFromIndex(path: string) {
  try {
    await store.appState?.closeProject(path);
    store.appState?.setSettingsTab("projects");
  } catch (error) {
    reportError(error);
  }
}

function addProject() {
  void store.appState?.openProject().then(() => {
    recents.value = loadRecentProjects();
  });
}

/** Focus the search field after clearing it from the clear button. */
function clearSearch() {
  query.value = "";
  searchRef.value?.focus();
}

/** A row click: the open row closes, any other row opens its card. */
function selectRow(path: string) {
  openPath.value = nextArchiveOpenPath(openPath.value, path);
  menuFor.value = null;
}

function showMoreSessions() {
  const path = project.value?.path;
  if (!path) return;
  visibleSessionCounts.value = {
    ...visibleSessionCounts.value,
    [path]: visibleCount.value + INITIAL_VISIBLE_SESSION_COUNT,
  };
}

function showLessSessions() {
  const path = project.value?.path;
  if (!path) return;
  visibleSessionCounts.value = {
    ...visibleSessionCounts.value,
    [path]: INITIAL_VISIBLE_SESSION_COUNT,
  };
}

/** The row's rename dialog saves through the store, as the `onSave` did. */
function renameSessionFromIndex(title: string) {
  const session = renameFor.value;
  if (!session) return;
  return store.appState?.renameSession(session.id, title);
}

function instructionsSaved() {
  store.appState?.showToast(t("project.instructionsSaved"), { variant: "success" });
}

function memorySaved() {
  store.appState?.showToast(t("project.memorySaved"), { variant: "success" });
}

/**
 * The edit dialog's `onSaved`: rename locally and fold the returned group into
 * the durable list, matching either the new id or the id the row opened with.
 */
function projectEdited(group: ProjectGroupRecord) {
  const previous = editProjectFor.value;
  store.appState?.renameProject(group.primaryPath, group.name);
  durableProjects.value = durableProjects.value.map((item) =>
    item.id === group.id || item.id === previous?.groupId ? group : item,
  );
}

/** The delete dialog's `onDeleted`: close it, refresh recents, confirm. */
function projectDeleted() {
  const name = deleteFor.value?.name;
  deleteFor.value = null;
  recents.value = loadRecentProjects();
  if (name === undefined) return;
  store.appState?.showToast(t("project.deleted", { name }), { variant: "success" });
}
</script>

<template>
  <div class="settings-stack settings-project-archive">
    <div class="projects-intro">
      <p class="projects-intro-desc">{{ t("project.archiveSubtitle") }}</p>
    </div>

    <div class="projects-toolbar">
      <div
        class="settings-segment projects-sort"
        role="group"
        :aria-label="t('project.sortBy')"
      >
        <button
          v-for="mode in SORT_MODES"
          :key="mode"
          type="button"
          class="settings-segment-item projects-sort-btn"
          :class="{ active: sort === mode }"
          :aria-pressed="sort === mode"
          @click="sort = mode"
        >
          {{ t(mode === "recent" ? "project.sortRecent" : "project.sortName") }}
        </button>
      </div>
      <div class="projects-search-wrap">
        <IconSearch :size="13" aria-hidden="true" />
        <input
          ref="searchRef"
          v-model="query"
          class="projects-search"
          :placeholder="t('project.searchPlaceholder')"
          :aria-label="t('project.searchPlaceholder')"
          :spellcheck="false"
          autocorrect="off"
          autocapitalize="off"
          @keydown="
            (event) => {
              if (event.key === 'Escape' && query) {
                event.preventDefault();
                query = '';
              }
            }
          "
        />
        <TooltipButton
          v-if="searching"
          as="button"
          type="button"
          class="projects-search-clear"
          :label="t('project.clearSearch')"
          :aria-label="t('project.clearSearch')"
          @click="clearSearch"
        >
          <IconX :size="12" />
        </TooltipButton>
      </div>
      <span v-if="searching" class="projects-result-count" aria-live="polite">
        {{ t("project.resultCount", { count: filtered.length, total: items.length }) }}
      </span>
      <div class="projects-toolbar-actions">
        <Button variant="primary" @click="addProject">
          <IconPlus :size="14" />
          {{ t("project.add") }}
        </Button>
      </div>
    </div>

    <div v-if="sections.length === 0" class="settings-panel projects-empty">
      <span class="projects-empty-icon" aria-hidden="true">
        <IconArchive :size="18" />
      </span>
      <div class="projects-empty-title">
        {{ items.length === 0 ? t("project.noProjects") : t("project.noSearchResults") }}
      </div>
      <div v-if="items.length !== 0" class="projects-empty-body">
        {{ t("project.noSearchResultsBody") }}
      </div>
      <Button v-if="items.length === 0" variant="primary" @click="addProject">
        <IconPlus :size="14" />
        {{ t("project.add") }}
      </Button>
      <Button v-else variant="secondary" @click="query = ''">
        {{ t("project.clearSearch") }}
      </Button>
    </div>

    <div v-else class="projects-workbench" tabindex="0" @keydown="onIndexKeyDown">
      <ProjectArchiveIndex
        :groups="sections"
        :open-path="openPath"
        :workspace-path="workspace?.path"
        :open-project-paths="openProjectPaths"
        :locale="locale"
        :session-counts="sessionCounts"
        @select="selectRow"
        @activate="(path) => activate(path)"
      >
        <template #detail>
          <ProjectDetailPanel
            v-if="project"
            :project="project"
            :sessions="visibleSessions"
            :displayed-count="selectedSessions.displayed.length"
            :hidden-count="hiddenSessionCount"
            :initial-count="INITIAL_VISIBLE_SESSION_COUNT"
            :locale="locale"
            @open-session="(sessionId) => openProjectSession(project!.path, sessionId)"
            @new-task="startTask(project!.path)"
            @rename-session="renameFor = $event"
            @show-more="showMoreSessions"
            @show-less="showLessSessions"
          >
            <template #actions>
              <Button
                v-if="!selectedActive"
                size="sm"
                variant="primary"
                @click="activate(project!.path)"
              >
                {{ t("project.open") }}
              </Button>
              <AnchoredMenu
                class="projects-menu-wrap"
                :open="menuOpen"
                menu-class-name="projects-menu"
                :label="t('project.openActions', { name: project!.name })"
                role="menu"
                align="end"
                @close="menuFor = null"
              >
                <template #trigger="{ setAnchor }">
                  <TooltipButton
                    :ref="setAnchor"
                    as="button"
                    type="button"
                    class="projects-icon-btn"
                    :label="t('project.openActions', { name: project!.name })"
                    :aria-label="t('project.openActions', { name: project!.name })"
                    aria-haspopup="menu"
                    :aria-expanded="menuOpen"
                    @click="menuFor = menuFor === project!.path ? null : project!.path"
                  >
                    <IconMore :size="16" />
                  </TooltipButton>
                </template>

                <button
                  type="button"
                  role="menuitem"
                  @click="
                    menuFor = null;
                    startTask(project!.path);
                  "
                >
                  <IconChat :size="14" />
                  {{ t("project.newTask") }}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  @click="
                    menuFor = null;
                    instructionsFor = {
                      name: project!.name,
                      path: project!.path,
                      groupId: project!.groupId,
                      legacy: project!.legacy,
                    };
                  "
                >
                  <IconFileText :size="14" />
                  {{ t("project.editInstructions") }}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  @click="
                    menuFor = null;
                    memoryFor = {
                      name: project!.name,
                      path: project!.path,
                      groupId: project!.groupId,
                      legacy: project!.legacy,
                    };
                  "
                >
                  <IconSparkles :size="14" />
                  {{ t("project.editMemory") }}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-action="edit-project"
                  @click="
                    menuFor = null;
                    editProjectFor = {
                      path: project!.path,
                      name: project!.name,
                      groupId: project!.groupId,
                      roots: project!.roots,
                      legacy: project!.legacy,
                    };
                  "
                >
                  <IconPencil :size="14" />
                  {{ t("project.edit") }}
                </button>
                <div class="projects-menu-sep" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  @click="
                    store.appState?.toggleProjectPinned(project!.path, !project!.pinned);
                    menuFor = null;
                  "
                >
                  <IconPin :size="14" />
                  {{ project!.pinned ? t("project.unpin") : t("project.pin") }}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  @click="toggleProjectArchive(project!)"
                >
                  <IconArchiveRestore v-if="selectedArchived" :size="14" />
                  <IconArchive v-else :size="14" />
                  {{ selectedArchived ? t("project.restore") : t("project.archive") }}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="danger"
                  :class="{
                    'is-armed': armedDelete === projectDeleteKey(project!.path),
                  }"
                  data-action="delete-project"
                  :data-armed="
                    armedDelete === projectDeleteKey(project!.path) ? 'true' : undefined
                  "
                  @click="requestDeleteProject(project!, totalSessions)"
                >
                  <IconTrash :size="14" />
                  {{
                    armedDelete === projectDeleteKey(project!.path)
                      ? t("project.deleteMenuConfirm")
                      : t("project.delete")
                  }}
                </button>
                <button
                  v-if="selectedRetained"
                  type="button"
                  role="menuitem"
                  class="danger"
                  @click="
                    menuFor = null;
                    closeProjectFromIndex(project!.path);
                  "
                >
                  <IconX :size="14" />
                  {{ t("project.close") }}
                </button>
              </AnchoredMenu>
            </template>
          </ProjectDetailPanel>
        </template>
      </ProjectArchiveIndex>
    </div>

    <ProjectInstructionsDialog
      v-if="instructionsFor"
      :project="instructionsFor"
      @close="instructionsFor = null"
      @saved="instructionsSaved"
      @error="reportError"
    />
    <ProjectMemoryDialog
      v-if="memoryFor"
      :project="memoryFor"
      @close="memoryFor = null"
      @saved="memorySaved"
      @error="reportError"
    />
    <SessionRenameDialog
      v-if="renameFor"
      :session="renameFor"
      @close="renameFor = null"
      @saved="renameSessionFromIndex"
      @error="reportError"
    />
    <ProjectEditDialog
      v-if="editProjectFor"
      :project="editProjectFor"
      @close="editProjectFor = null"
      @saved="projectEdited"
      @error="reportError"
    />
    <ProjectDeleteDialog
      v-if="deleteFor"
      :project="deleteFor"
      :running-session-ids="deleteRunningSessionIds"
      @close="deleteFor = null"
      @deleted="projectDeleted"
      @error="reportError"
    />
  </div>
</template>
