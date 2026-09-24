<script setup lang="ts">
/**
 * Home-hero project name button and its switcher menu.
 *
 * The `HomeProjectSwitcher` component. The project list, the
 * filter and the path normalization all come from
 * `lib/sidebar-preferences.ts` and `lib/git-clone-url.ts`, so this file is only
 * the reactive plumbing.
 *
 * The decisions that are not mechanical:
 *
 *  1. **The menu shell is `components/settings/AnchoredMenu.vue`.** It
 *     takes a `trigger(ref)` render prop; a Vue template cannot return markup
 *     from a composable, so the trigger is the scoped `#trigger` slot and
 *     `setAnchor` is the ref it is bound to. `onMenuKeyDown` is that
 *     component's `menu-keydown` emit.
 *  2. **`useAppStore.getState()` inside `startClone` / `pickFolder` is
 *     `currentAppState()`.** Both read `workspace.path` to compare the project
 *     before and after an awaited store action, which is exactly the
 *     mid-request snapshot `stores/app-store.ts` exports `currentAppState()`
 *     for; a component may not call `getState()` (see docs/ARCHITECTURE.md).
 *  3. **`activeKey` and `visible` are computeds, and the highlight effects are
 *     watchers.** The `useMemo` pair becomes `computed`, and the two
 *     `useEffect`s (seed the highlight when the menu opens, scroll the
 *     highlighted row into view) become `watch`es. Both read the DOM after the
 *     row list has been patched, so they are `flush: "post"`, the same reason
 *     `SearchDialog.vue`'s scroll watcher is.
 *  4. The `busy` guard is unchanged in intent but paired with a plain
 *     `busyRef`: the trigger, every row and the clone submit all disable while a
 *     project switch or clone is in flight, and the ref closes the gap before
 *     Vue re-renders the disabled control, so a rapid second click cannot start
 *     a second request, and the ref exists for exactly that reason.
 *
 * `sr-only` is a Tailwind accessibility utility this component relies on but
 * which the shared stylesheet never defines, so it is allowlisted in
 * `tests/helpers/class-contract.mjs` like the other `sr-only` sites.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { parseGitCloneUrl } from "../lib/git-clone-url";
import {
  filterSwitcherProjects,
  listSwitcherProjects,
  normalizeProjectPath,
} from "../lib/sidebar-preferences";
import { currentAppState, useAppStore } from "../stores/app-store";
import {
  IconBranch,
  IconCheck,
  IconChevronLeft,
  IconFolder,
  IconNewProject,
  IconSearch,
} from "../lib/icons";
import AnchoredMenu from "./settings/AnchoredMenu.vue";
import { cx } from "../lib/cx";

const props = withDefaults(
  defineProps<{ name: string; path?: string | null }>(),
  { path: null },
);

const { t } = useI18n();
const store = useAppStore();

const openProjectPaths = computed(() => store.appState?.openProjectPaths ?? []);
const openProjects = computed(() => store.appState?.openProjects ?? []);
const workspace = computed(() => store.appState?.workspace);
const projectMeta = computed(() => store.appState?.projectMeta ?? {});
const projectSort = computed(() => store.appState?.projectSort);
const activeProjectPath = computed(() => store.appState?.activeProjectPath);

const open = ref(false);
const view = ref<"list" | "clone">("list");
const query = ref("");
const cloneUrl = ref("");
const highlight = ref(0);
const busy = ref(false);
const busyRef = ref(false);

const projects = computed(() =>
  listSwitcherProjects({
    openProjectPaths: openProjectPaths.value,
    openProjects: openProjects.value,
    workspace: workspace.value,
    projectMeta: projectMeta.value,
    // The store always carries a sort; the fallback only satisfies the type
    // before the first commit, when nothing can be listed anyway.
    projectSort: projectSort.value ?? "recent",
  }),
);
const visible = computed(() => filterSwitcherProjects(projects.value, query.value));
const activeKey = computed(() => normalizeProjectPath(activeProjectPath.value ?? props.path));
const cloneTarget = computed(() => parseGitCloneUrl(cloneUrl.value));

function close(): void {
  open.value = false;
  query.value = "";
  view.value = "list";
  cloneUrl.value = "";
}

function reportError(error: unknown): void {
  store.appState?.showToast(
    error instanceof Error ? error.message : String(error),
    { variant: "error" },
  );
}

async function selectProject(nextPath: string): Promise<void> {
  if (busy.value || busyRef.value) return;
  const nextKey = normalizeProjectPath(nextPath);
  close();
  if (!nextKey || nextKey === activeKey.value) return;
  busyRef.value = true;
  busy.value = true;
  try {
    await store.appState?.newSession({ projectPath: nextPath });
  } catch (error) {
    reportError(error);
  } finally {
    busyRef.value = false;
    busy.value = false;
  }
}

async function startClone(): Promise<void> {
  const target = cloneTarget.value;
  if (busy.value || busyRef.value || !target) return;
  busyRef.value = true;
  busy.value = true;
  try {
    const previous = normalizeProjectPath(currentAppState().workspace?.path);
    const cloned = await store.appState?.cloneProject(target.url);
    if (!cloned?.path) return;
    close();
    const nextKey = normalizeProjectPath(cloned.path);
    if (nextKey && nextKey !== previous) {
      await store.appState?.newSession({ projectPath: cloned.path });
    }
  } catch (error) {
    reportError(error);
  } finally {
    busyRef.value = false;
    busy.value = false;
  }
}

async function pickFolder(): Promise<void> {
  if (busy.value || busyRef.value) return;
  busyRef.value = true;
  busy.value = true;
  try {
    const previous = normalizeProjectPath(currentAppState().workspace?.path);
    await store.appState?.openProject();
    const nextPath = currentAppState().workspace?.path;
    const nextKey = normalizeProjectPath(nextPath);
    if (nextPath && nextKey && nextKey !== previous) {
      await store.appState?.newSession({ projectPath: nextPath });
    }
  } catch (error) {
    reportError(error);
  } finally {
    busyRef.value = false;
    busy.value = false;
  }
}

/*
 * Seed the highlight on the active project when the menu opens. Post-flush
 * because `visible` is read against the freshly listed rows, and the second
 * watcher below then scrolls whatever this one selected.
 */
watch(
  [activeKey, open, visible],
  () => {
    if (!open.value) return;
    const current = visible.value.findIndex(
      (project) => project.key === activeKey.value,
    );
    highlight.value = current >= 0 ? current : 0;
  },
  { flush: "post" },
);

watch(
  [highlight, open, view],
  () => {
    if (!open.value || view.value !== "list") return;
    document
      .querySelector<HTMLElement>(`[data-switcher-index="${highlight.value}"]`)
      ?.scrollIntoView({ block: "nearest" });
  },
  { flush: "post" },
);

function moveHighlight(delta: number): void {
  if (visible.value.length === 0) return;
  highlight.value =
    (highlight.value + delta + visible.value.length) % visible.value.length;
}

function onMenuKeyDown(event: KeyboardEvent): void {
  if (view.value === "clone") return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveHighlight(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveHighlight(-1);
  } else if (event.key === "Enter") {
    const target = visible.value[highlight.value];
    if (!target) return;
    event.preventDefault();
    void selectProject(target.path);
  }
}

/** Enter submits the clone form; the input is the only field it has. */
function onCloneInputKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void startClone();
}

/** The "Clone git project" row swaps the list view for the clone form. */
function openCloneView(): void {
  cloneUrl.value = "";
  view.value = "clone";
}

function toggleOpen(): void {
  if (open.value) {
    close();
    return;
  }
  query.value = "";
  view.value = "list";
  cloneUrl.value = "";
  open.value = true;
}
</script>

<template>
  <AnchoredMenu
    class="home-project-switcher"
    :open="open"
    menu-class-name="home-project-switcher-menu"
    :label="t('project.switchProject')"
    role="menu"
    align="start"
    side="bottom"
    initial-focus="input"
    @close="close"
    @menu-keydown="onMenuKeyDown"
  >
    <template #trigger="{ setAnchor }">
      <button
        :ref="setAnchor"
        type="button"
        class="project-underline"
        data-testid="home-project-switcher"
        aria-haspopup="menu"
        :aria-expanded="open"
        :aria-label="`${t('project.switchProject')}: ${props.name}`"
        :title="props.path || t('project.switchProject')"
        :disabled="busy"
        @click="toggleOpen"
      >
        {{ props.name }}
      </button>
    </template>

    <div v-if="view === 'clone'" class="home-project-switcher-clone">
      <button
        type="button"
        class="home-project-switcher-item"
        :disabled="busy"
        @click="view = 'list'"
      >
        <IconChevronLeft :size="14" aria-hidden="true" />
        <span class="home-project-switcher-item-name">
          {{ t("project.clone") }}
        </span>
      </button>
      <label class="home-project-switcher-search">
        <IconBranch :size="13" aria-hidden="true" />
        <span class="sr-only">{{ t("project.cloneUrlPlaceholder") }}</span>
        <input
          type="text"
          :value="cloneUrl"
          :placeholder="t('project.cloneUrlPlaceholder')"
          :aria-label="t('project.cloneUrlPlaceholder')"
          spellcheck="false"
          autocorrect="off"
          autocapitalize="off"
          autocomplete="off"
          :disabled="busy"
          @input="cloneUrl = ($event.target as HTMLInputElement).value"
          @keydown="onCloneInputKeyDown"
        />
      </label>
      <p class="home-project-switcher-clone-hint">
        {{
          cloneTarget
            ? t("project.cloneDestHint", { name: cloneTarget.name })
            : t("project.cloneUrlHint")
        }}
      </p>
      <button
        type="button"
        class="home-project-switcher-clone-submit"
        :disabled="busy || !cloneTarget"
        @click="void startClone()"
      >
        {{ busy ? t("project.cloning") : t("project.cloneAction") }}
      </button>
    </div>
    <template v-else>
      <label class="home-project-switcher-search">
        <IconSearch :size="13" aria-hidden="true" />
        <span class="sr-only">{{ t("project.searchPlaceholder") }}</span>
        <input
          type="text"
          :value="query"
          :placeholder="t('project.searchPlaceholder')"
          :aria-label="t('project.searchPlaceholder')"
          aria-controls="home-project-switcher-list"
          :aria-activedescendant="
            visible[highlight]
              ? `home-project-switcher-option-${highlight}`
              : undefined
          "
          spellcheck="false"
          autocorrect="off"
          autocapitalize="off"
          autocomplete="off"
          @input="query = ($event.target as HTMLInputElement).value"
        />
      </label>
      <div
        id="home-project-switcher-list"
        class="home-project-switcher-list"
        role="none"
      >
        <div v-if="visible.length === 0" class="home-project-switcher-empty">
          {{ t("project.noSearchResults") }}
        </div>
        <template v-else>
          <button
            v-for="(project, index) in visible"
            :id="`home-project-switcher-option-${index}`"
            :key="project.key"
            type="button"
            role="menuitemradio"
            :tabindex="-1"
            :aria-checked="project.key === activeKey"
            :data-switcher-index="index"
            :title="project.path"
            :class="
              cx(
                'home-project-switcher-item',
                project.key === activeKey && 'is-current',
                highlight === index && 'is-active',
              )
            "
            :disabled="busy"
            @mouseenter="highlight = index"
            @click="void selectProject(project.path)"
          >
            <IconFolder :size="14" aria-hidden="true" />
            <span class="home-project-switcher-item-name">
              {{ project.name }}
            </span>
            <IconCheck
              v-if="project.key === activeKey"
              :size="14"
              class="home-project-switcher-check"
              aria-hidden="true"
            />
          </button>
        </template>
      </div>
      <div class="home-project-switcher-divider" aria-hidden="true" />
      <button
        type="button"
        role="menuitem"
        class="home-project-switcher-item"
        :disabled="busy"
        @click="openCloneView"
      >
        <IconBranch :size="14" aria-hidden="true" />
        <span class="home-project-switcher-item-name">
          {{ t("project.clone") }}
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        class="home-project-switcher-item"
        :disabled="busy"
        @click="void pickFolder()"
      >
        <IconNewProject :size="14" aria-hidden="true" />
        <span class="home-project-switcher-item-name">
          {{ t("project.open") }}
        </span>
      </button>
    </template>
  </AnchoredMenu>
</template>
