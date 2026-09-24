<script setup lang="ts">
/**
 * Global search (⌘K spotlight).
 *
 * The `SearchDialog` component. The prop/emit contract is the shell's, not this
 * file's: the previous version took `{ open, onClose }`, this component takes `open` and emits
 * `close`, because `features/app/AppShell.vue` mounts it twice as
 * `<SearchDialog :open="searchOpen" @close="setSearchOpen(false)" />`.
 *
 * The decisions that are not mechanical:
 *
 *  1. **One listbox, four sources.** Every option is numbered by hand:
 *     session rows own `1 + matches.length` slots each, then "load more",
 *     pages, settings and commands. Those bases (`moreIndex`, `pageBase`,
 *     `settingsBase`, `commandsBase`, `optionCount`) and the dispatch order in
 *     `runActive` are copied verbatim — the ids the rows carry and the option
 *     `active` names must agree exactly or Enter runs the wrong row.
 *  2. **The stale-selection guard.** The `selectionRequest = useRef(0)`
 *     is incremented by an effect on `[open, query]`; `run()` captures
 *     `++selectionRequest.current` and bails when it changed, or when the store
 *     did not land on the expected session/page. That is a real race guard (a
 *     second selection, or a query edit, must abandon the first), so it is a
 *     plain `let` in this setup with a `watch` replacing the effect.
 *  3. **`currentAppState()` for the guard, `store.appState` for everything
 *     else.** The guard needs the *committed* state right after an `await`, and
 *     a tracked read is meaningless outside render; `stores/app-store.ts`
 *     exposes `currentAppState()` as the counterpart of the store's
 *     `useAppStore.getState()`, which components are forbidden to call.
 *  4. **The hook's computeds are destructured.** `useSessionSearch()` returns a
 *     plain object of `ComputedRef`s; Vue only unwraps refs that are top-level
 *     setup bindings, so `search.loading` in a template would be the ref object
 *     (always truthy) and `search.nextOffset !== null` always true. Destructured
 *     names unwrap correctly in the template and need `.value` in the script.
 *  5. **The scroll watcher runs post-flush.** The effect ran after the
 *     DOM commit; a default (pre) watcher would scroll the *previous* active
 *     option, so that one watcher is `{ flush: "post" }`.
 *  6. `highlightMatch(text, query)` (a vnode-returning helper) is the
 *     `SearchHighlight` component used directly, since a `<script setup>` body
 *     cannot build template nodes.
 */
import { computed, ref, watch, type ComponentPublicInstance } from "vue";
import { useI18n } from "vue-i18n";
import type { CommandItem, SessionSummary } from "@dcode/shared";
import { api } from "../lib/api";
import { runPaletteCommand } from "../lib/commands";
import {
  currentAppState,
  isDefaultSessionTitle,
  useAppStore,
} from "../stores/app-store";
import { normalizeProjectPath } from "../lib/sidebar-session-groups";
import { searchSettings, type SettingsSearchHit } from "../lib/settings-search";
import { useSessionSearch, useSessionSearchState } from "../hooks/use-session-search";
import type { SessionMeta } from "../lib/sidebar-preferences";
import SearchHighlight from "./SearchHighlight.vue";
import SearchSessionResults, { type SearchRow } from "./SearchSessionResults.vue";
import {
  IconAt,
  IconClock,
  IconNewSession,
  IconPullRequest,
  IconSearch,
  IconSettings,
  IconSliders,
} from "../lib/icons";

/** Navigable pages surfaced by the global search alongside sessions. */
const PAGE_ENTRIES = [
  { page: "pulls", labelKey: "pulls.title", icon: IconPullRequest },
  { page: "scheduled", labelKey: "scheduled.title", icon: IconClock },
  { page: "plugins", labelKey: "nav.plugins", icon: IconAt },
] as const;

type PageEntry = (typeof PAGE_ENTRIES)[number];

const GROUP_KEYS = [
  "today",
  "yesterday",
  "previous7Days",
  "previous30Days",
  "earlier",
] as const;

type GroupKey = (typeof GROUP_KEYS)[number];

const DAY_MS = 86_400_000;

function sessionArchived(
  session: SessionSummary,
  meta: SessionMeta | undefined,
): boolean {
  return Boolean(
    meta?.archived || (session as SessionSummary & { archived?: boolean }).archived,
  );
}

function projectBasename(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function groupKeyFor(updatedAt: string | undefined, startOfToday: number): GroupKey {
  const ts = updatedAt ? Date.parse(updatedAt) : NaN;
  if (!Number.isFinite(ts)) return "earlier";
  if (ts >= startOfToday) return "today";
  if (ts >= startOfToday - DAY_MS) return "yesterday";
  if (ts >= startOfToday - 7 * DAY_MS) return "previous7Days";
  if (ts >= startOfToday - 30 * DAY_MS) return "previous30Days";
  return "earlier";
}

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const store = useAppStore();
const sessions = computed(() => store.appState?.sessions ?? []);
const sessionMeta = computed(() => store.appState?.sessionMeta ?? {});
const openProjects = computed(() => store.appState?.openProjects ?? []);
const workspace = computed(() => store.appState?.workspace);
const runningSessions = computed(() => store.appState?.runningSessions ?? {});

const { query, setQuery } = useSessionSearchState();
const {
  hits: searchHits,
  nextOffset: searchNextOffset,
  error: searchError,
  loading: searchLoading,
  loadMore: searchLoadMore,
  retry: searchRetry,
} = useSessionSearch(() => props.open, query);

/**
 * Guards a stale async selection: bumped whenever the dialog opens or the
 * query changes, captured by `run`, and compared again after the await.
 */
let selectionRequest = 0;
watch([() => props.open, query], () => {
  selectionRequest += 1;
}, { immediate: true });

const active = ref(0);
const commandResult = ref<{ query: string; hits: CommandItem[] }>({
  query: "",
  hits: [],
});
const commandHits = computed(() =>
  commandResult.value.query === query.value ? commandResult.value.hits : [],
);

/*
  Focus the node when it is inserted and never write an `autofocus` attribute,
  the way `autoFocus` did. The overlay is `v-if`'d on `open`, so a function ref
  fires each time the input is inserted — the same moment a commit does —
  and the rendered DOM keeps no attribute that would not have been written.
  A function ref also runs on every *patch*, not only on insertion (verified in
  the installed `@vue/runtime-core`: `setRef` calls it unconditionally), so
  focusing on each call would drag focus back to the field whenever anything
  re-renders — typing updates `:value`, and arrow-key navigation re-renders the
  rows. Tracking the attached element's identity focuses exactly once per
  insertion; the unmount call passes `null`, so re-opening focuses again.
*/
let focusedInput: HTMLInputElement | null = null;
function focusInput(element: Element | ComponentPublicInstance | null) {
  if (!(element instanceof HTMLInputElement)) {
    focusedInput = null;
    return;
  }
  if (focusedInput === element) return;
  focusedInput = element;
  element.focus();
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    active.value = 0;
    commandResult.value = { ...commandResult.value, hits: [] };
    // Catch sessions renamed/created since the last store refresh.
    void store.appState?.refreshSessions().catch(() => undefined);
  },
  { immediate: true },
);

// Surface command-palette commands inside global search so a single
// surface covers sessions, pages, settings, and commands.
watch(
  [query, () => props.open],
  ([, isOpen], _previous, onCleanup) => {
    if (!isOpen) return;
    let cancelled = false;
    const current = query.value;
    const handle = window.setTimeout(() => {
      void api
        .searchCommands(current)
        .then((res) => {
          if (!cancelled) commandResult.value = { query: current, hits: res.commands };
        })
        .catch(() => {
          if (!cancelled) commandResult.value = { query: current, hits: [] };
        });
    }, 80);
    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(handle);
    });
  },
  // Immediate, because the effect ran on mount as well as on change.
  { immediate: true },
);

const projectNames = computed(() => {
  const names = new Map<string, string>();
  for (const project of openProjects.value) {
    const key = normalizeProjectPath(project.path);
    if (key && project.name?.trim()) names.set(key, project.name.trim());
  }
  const wsKey = normalizeProjectPath(workspace.value?.path);
  if (wsKey && workspace.value?.name?.trim() && !names.has(wsKey)) {
    names.set(wsKey, workspace.value.name.trim());
  }
  return names;
});

const rows = computed<SearchRow[]>(() => {
  const q = query.value.trim().toLowerCase();
  const candidates: Omit<SearchRow, "optionIndex">[] = [];
  const source = q ? searchHits.value.map((hit) => hit.session) : sessions.value;
  const hits = new Map(searchHits.value.map((hit) => [hit.session.id, hit]));
  for (const session of source) {
    // Untitled drafts carry no searchable signal; they stay sidebar-only.
    if (!q && isDefaultSessionTitle(session.title)) continue;
    const archived = sessionArchived(session, sessionMeta.value[session.id]);
    // Recents view keeps the sidebar's default: archived stays hidden
    // until the user actually searches for it.
    if (archived && !q) continue;
    const projectKey = normalizeProjectPath(session.projectPath);
    const hit = q ? hits.get(session.id) : undefined;
    const projectLabel =
      hit?.projectName ||
      (projectKey
        ? (projectNames.value.get(projectKey) ?? projectBasename(projectKey))
        : t("nav.temporarySessions"));
    candidates.push({ session, archived, projectLabel, hit });
  }
  candidates.sort((a, b) => {
    const aTs = Date.parse(a.session.updatedAt || "") || 0;
    const bTs = Date.parse(b.session.updatedAt || "") || 0;
    return bTs - aTs || a.session.id.localeCompare(b.session.id);
  });
  let index = 1;
  return (q ? candidates : candidates.slice(0, 30)).map((row) => {
    const optionIndex = index;
    index += 1 + (row.hit?.matches.length ?? 0);
    return { ...row, optionIndex };
  });
});

const groups = computed(() => {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const byKey = new Map<GroupKey, SearchRow[]>();
  for (const row of rows.value) {
    const key = groupKeyFor(row.session.updatedAt, startOfToday);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else byKey.set(key, [row]);
  }
  return GROUP_KEYS.filter((key) => byKey.has(key)).map((key) => ({
    key,
    rows: byKey.get(key)!,
  }));
});

// Pages and settings rows join the listbox after the session results;
// flat option order is: new-task, sessions, pages, settings.
const pageHits = computed<PageEntry[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return [];
  return PAGE_ENTRIES.filter((entry) => t(entry.labelKey).toLowerCase().includes(q));
});

// Settings search mirrors the rail: developer-only destinations stay out of
// the result list while developer mode is off.
const developerMode = computed(() => store.appState?.settings?.developerMode === true);

const settingsHits = computed<SettingsSearchHit[]>(() =>
  searchSettings(query.value, t, { developerMode: developerMode.value }),
);

const sessionOptionCount = computed(() =>
  rows.value.reduce(
    (count, row) => count + 1 + (row.hit?.matches.length ?? 0),
    0,
  ),
);
const moreIndex = computed(() => sessionOptionCount.value + 1);
const pageBase = computed(
  () =>
    moreIndex.value +
    (query.value.trim() && searchNextOffset.value !== null ? 1 : 0),
);
const settingsBase = computed(() => pageBase.value + pageHits.value.length);
const commandsBase = computed(() => settingsBase.value + settingsHits.value.length);
const optionCount = computed(() => commandsBase.value + commandHits.value.length);

watch(query, () => {
  active.value = 0;
});

watch(optionCount, (value) => {
  active.value = Math.min(active.value, value - 1);
});

watch(
  [active, () => props.open],
  ([, isOpen]) => {
    if (!isOpen) return;
    document
      .getElementById(`global-search-option-${active.value}`)
      ?.scrollIntoView({ block: "nearest" });
  },
  // Post-flush: the option ids are derived from `active`, so the scroll has to
  // happen after the row list has been patched (the commit has landed).
  { flush: "post" },
);

const run = async (row: SearchRow | null, messageId?: string) => {
  const request = ++selectionRequest;
  try {
    if (row) {
      const current = currentAppState();
      if (current.activeSessionId === row.session.id && !current.selectingSessionId) {
        current.setPage("chat");
      } else {
        await store.appState?.selectSession(row.session.id);
      }
      const selected = currentAppState();
      if (
        request !== selectionRequest ||
        selected.activeSessionId !== row.session.id ||
        selected.page !== "chat"
      )
        return;
      const targetId = messageId ?? row.hit?.matches[0]?.messageId;
      if (targetId)
        void selected.navigateTranscript({
          sessionId: row.session.id,
          messageId: targetId,
          query: query.value.trim(),
        });
    } else {
      await store.appState?.newSession();
    }
    emit("close");
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLTextAreaElement>(".composer-input")
        ?.focus({ preventScroll: true });
    });
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
  }
};

const openSettingsHit = (hit: SettingsSearchHit) => {
  store.appState?.setSettingsAnchor(hit.rowKey);
  store.appState?.setSettingsTab(hit.tab);
  emit("close");
};

const openPage = (entry: PageEntry) => {
  store.appState?.setPage(entry.page);
  emit("close");
};

const runCommand = async (command: CommandItem) => {
  try {
    await runPaletteCommand(command.id);
    emit("close");
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
  }
};

const runActive = () => {
  if (active.value === 0) return void run(null);
  for (const row of rows.value) {
    if (active.value === row.optionIndex) return void run(row);
    const match = row.hit?.matches[active.value - row.optionIndex - 1];
    if (match) return void run(row, match.messageId);
  }
  if (active.value === moreIndex.value && searchNextOffset.value !== null)
    return searchLoadMore();
  const pageIndex = active.value - pageBase.value;
  if (pageIndex >= 0 && pageIndex < pageHits.value.length)
    return openPage(pageHits.value[pageIndex]);
  const settingsIndex = active.value - settingsBase.value;
  if (settingsIndex >= 0 && settingsIndex < settingsHits.value.length) {
    return openSettingsHit(settingsHits.value[settingsIndex]);
  }
  const commandIndex = active.value - commandsBase.value;
  if (commandIndex >= 0 && commandIndex < commandHits.value.length) {
    return void runCommand(commandHits.value[commandIndex]);
  }
};

/** Escape must close even when focus left the input (e.g. tabbing). */
function onDialogKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
}

function onInputKeyDown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    active.value = Math.min(active.value + 1, optionCount.value - 1);
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    active.value = Math.max(active.value - 1, 0);
  }
  if (event.key === "Enter") {
    event.preventDefault();
    runActive();
  }
}
</script>

<template>
  <div v-if="open" class="search-overlay" @click="emit('close')">
    <div
      class="search-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('nav.search')"
      @click.stop
      @keydown="onDialogKeyDown"
    >
      <div class="search-input-row">
        <IconSearch :size="16" aria-hidden="true" />
        <input
          class="search-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="global-search-results"
          :aria-activedescendant="`global-search-option-${active}`"
          :aria-label="t('nav.search')"
          :placeholder="t('search.placeholder')"
          :value="query"
          maxlength="500"
          :ref="focusInput"
          spellcheck="false"
          autocorrect="off"
          autocapitalize="off"
          @input="setQuery(($event.target as HTMLInputElement).value)"
          @keydown="onInputKeyDown"
        />
      </div>
      <div
        id="global-search-results"
        class="search-results"
        role="listbox"
        :aria-label="t('nav.search')"
      >
        <button
          id="global-search-option-0"
          type="button"
          role="option"
          :aria-selected="active === 0"
          class="search-item"
          :class="{ active: active === 0 }"
          @mouseenter="active = 0"
          @click="void run(null)"
        >
          <IconNewSession :size="15" class="search-item-icon" />
          <span class="search-item-title">{{ t("nav.newTask") }}</span>
        </button>
        <SearchSessionResults
          :groups="groups"
          :query="query"
          :active="active"
          :running-sessions="runningSessions"
          @activate="active = $event"
          @select="(row, messageId) => void run(row, messageId)"
        />
        <div v-if="query.trim() && searchLoading" class="search-empty" role="status">
          {{ t("search.loading") }}
        </div>
        <div v-if="query.trim() && searchError" class="search-empty" role="alert">
          {{ t("search.failed") }}
          <button type="button" class="btn btn-secondary" @click="searchRetry">
            {{ t("search.retry") }}
          </button>
        </div>
        <button
          v-if="query.trim() && searchNextOffset !== null"
          :id="`global-search-option-${moreIndex}`"
          type="button"
          role="option"
          :aria-selected="active === moreIndex"
          :aria-disabled="searchLoading"
          class="search-item"
          :class="{ active: active === moreIndex }"
          @mouseenter="active = moreIndex"
          @click="searchLoadMore"
        >
          {{ t("search.loadMore") }}
        </button>
        <div v-if="pageHits.length > 0" role="presentation">
          <div class="search-group-label" role="presentation">
            {{ t("search.pages") }}
          </div>
          <button
            v-for="(entry, index) in pageHits"
            :key="entry.page"
            :id="`global-search-option-${pageBase + index}`"
            type="button"
            role="option"
            :aria-selected="active === pageBase + index"
            class="search-item"
            :class="{ active: active === pageBase + index }"
            @mouseenter="active = pageBase + index"
            @click="openPage(entry)"
          >
            <component :is="entry.icon" :size="15" class="search-item-icon" />
            <span class="search-item-title">
              <SearchHighlight :text="t(entry.labelKey)" :query="query" />
            </span>
          </button>
        </div>
        <div v-if="settingsHits.length > 0" role="presentation">
          <div class="search-group-label" role="presentation">
            {{ t("nav.settings") }}
          </div>
          <button
            v-for="(hit, index) in settingsHits"
            :key="`${hit.tab}:${hit.rowKey ?? 'tab'}`"
            :id="`global-search-option-${settingsBase + index}`"
            type="button"
            role="option"
            :aria-selected="active === settingsBase + index"
            class="search-item"
            :class="{ active: active === settingsBase + index }"
            @mouseenter="active = settingsBase + index"
            @click="openSettingsHit(hit)"
          >
            <IconSettings :size="15" class="search-item-icon" />
            <span class="search-item-title">
              <SearchHighlight :text="t(hit.rowKey ?? hit.tabLabelKey)" :query="query" />
            </span>
            <span v-if="hit.rowKey" class="search-item-meta">
              <span class="search-item-project">{{ t(hit.tabLabelKey) }}</span>
            </span>
          </button>
        </div>
        <div v-if="commandHits.length > 0" role="presentation">
          <div class="search-group-label" role="presentation">
            {{ t("search.commands") }}
          </div>
          <button
            v-for="(command, index) in commandHits"
            :key="command.id"
            :id="`global-search-option-${commandsBase + index}`"
            type="button"
            role="option"
            :aria-selected="active === commandsBase + index"
            class="search-item"
            :class="{ active: active === commandsBase + index }"
            @mouseenter="active = commandsBase + index"
            @click="void runCommand(command)"
          >
            <IconSliders :size="15" class="search-item-icon" />
            <span class="search-item-title">
              <SearchHighlight :text="command.title" :query="query" />
            </span>
            <span v-if="command.source === 'plugin'" class="search-item-badge">
              {{ t("plugins.title") }}
            </span>
          </button>
        </div>
        <div
          v-if="
            rows.length === 0 &&
            pageHits.length === 0 &&
            settingsHits.length === 0 &&
            commandHits.length === 0 &&
            query.trim() &&
            !searchLoading &&
            !searchError
          "
          class="search-empty"
        >
          {{ t("search.empty") }}
        </div>
      </div>
    </div>
  </div>
</template>
