<script setup lang="ts">
/**
 * Sidebar — the project/session navigator.
 *
 * The `Sidebar` component. The reactive shapes map onto this SFC as follows:
 *
 *   props `sidebarToggleShortcut`, `sidebarWidth`  ->  props of the same names
 *   props `onToggleSidebar`      ->  emit `toggle-sidebar`
 *   props `onWidthChange`        ->  emit `width-change`
 *   props `onWidthCommit`        ->  emit `width-commit`
 *   props `onAnimationEnd`       ->  emit `animationend` (forwarded from the
 *                                    root's native `animationend`)
 *   props `className`            ->  `:class` fallthrough onto the root
 *                                    `<aside>` (not declared as a prop)
 *
 * `useState`/`useMemo`/`useCallback`/`useEffect` become `ref`/`computed`/plain
 * functions/`watch` + mount hooks. The `useRef` slots split in two: the
 * ones that are rendered (`menuTriggerRef`, `menuFirstItemRef`) stay `ref`s, and
 * the ones that only carry mutable pointer state
 * (`sidebarResizeRef`, `projectReorderRef`) stay plain `ref`s too, because they
 * are read from window-level listeners installed outside the render pass.
 *
 * Deliberate choices:
 *
 * 1. `createPortal(., document.body)` becomes `<Teleport to="body">`, not
 *     `overlayRoot()`. The `#dcode-overlays` host sets
 *     `pointer-events: none` for anything that is not a direct `.overlay` child
 *     (`styles/ui-kit.css`), so a clickable sidebar menu parked there could not
 *     be clicked. `NotificationCenter.vue` reached the same conclusion for its
 * popover, which also needs `document.body`.
 * 2. The session list cannot be read through `useAppStore.getState()` inside
 *     `openSessionFromHover`: that read is untracked in Pinia, so this component uses
 *     the reactive `sessions` computed instead — same value, but the store
 *     contract of this repository forbids `getState()` in a component.
 *  3. `projectEntriesRef` and `reorderProjectEntriesRef` are gone. They existed
 *     to defeat stale closure capture; a `computed` and a
 *     function declared in `setup` are both stable and always current, so the
 *     indirection would only be noise.
 * 4. The `t(key, { defaultValue })` (i18next) becomes the local `tt()`
 *     helper — `te()` probes the key, and the English literal is the answer when
 *     the catalog has no entry. Only `nav.sessionPermission` is actually absent
 *     from both shipped catalogs; `AppShell.vue` uses the same idiom for the
 *     arch-name fallback.
 *  5. The session-row markup appears once per container (pinned, standalone,
 *     project group). An SFC has no template partials, and the brief here is
 *     explicitly "no new subcomponents", so the three copies are the honest
 *     spelling. Every piece of row *logic* is factored into
 *     `sessionRow()`/the row computeds, so the copies differ only in the list
 *     they iterate and stay in the template where `tests/vue-class-contract`
 *     can read their class names.
 *  6. The right-edge handle is live: `widthMax` is the shell's live three-column
 *     budget, pointer motion previews a 240..520px width anchored at the press
 *     position, a preview below `SIDEBAR_COLLAPSE_THRESHOLD` collapses the
 *     column instead, and release persists the preferred width. Double-clicking
 *     the handle resets it to the default inside the same budget. The shell
 *     owns the width (`lib/sidebar-resize.ts` holds the math); this component
 *     only reports the gesture.
 *  7. `aria-hidden` is always written with an explicit value: a bare
 *     `aria-hidden` renders `""` in a Vue template. Dynamic
 *     booleans (`:aria-hidden="collapsed"`) render `"true"`/`"false"` in both
 *     frameworks and are left as-is.
 *
 * Requires `components/TooltipButton.vue` to forward its non-prop attributes to
 * the anchor (the `TooltipButton` spread `{...buttonProps}` onto the
 * `<button>`). Without that forwarding, `data-nav` / `data-action` /
 * `aria-expanded` / `id` never reach the DOM, which breaks the
 * `.thread-item-more[aria-expanded="true"]` rule in `styles/sessions.css`, the
 * `aria-labelledby` wiring on each project group, and every `data-nav` hook the
 * e2e runners use.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ErrorCodes } from "@dcode/shared";
import type {
  ProjectGroupRecord,
  ProjectWorkspace,
  SessionSummary,
} from "@dcode/shared";
import { api } from "../lib/api";
import { composerDropItems, hasComposerFileDrag } from "../lib/composer-drop";
import { cx } from "../lib/cx";
import {
  getGlobalPinnedSessions,
  groupSidebarSessionsByTime,
  normalizeProjectPath,
  sessionArchived,
  sessionPinned,
} from "../lib/sidebar-session-groups";
import {
  projectGroupKeyFromPoint,
  projectReorderInsertAfter,
  projectReorderShouldArm,
  sameProjectReorderBucket,
} from "../lib/sidebar-project-reorder";
import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  type ProjectMeta,
  type ProjectSort,
  type SessionSort,
} from "../lib/sidebar-preferences";
import {
  sidebarPointerResize,
  sidebarResetWidth,
  SIDEBAR_RESIZE_STEP,
} from "../lib/sidebar-resize";
import {
  sidebarSessionStatus,
  type SidebarSessionStatus,
} from "../lib/sidebar-session-status";
import { isDefaultSessionTitle, useAppStore } from "../stores/app-store";
import { useArmedDelete } from "../hooks/use-armed-delete";
import { useUpdateState } from "../hooks/use-update-state";
import { useSessionHoverCard } from "../features/sessions/useSessionHoverCard";
import SessionHoverCard from "../features/sessions/SessionHoverCard.vue";
import BrandLogo from "./BrandLogo.vue";
import NotificationCenter from "./NotificationCenter.vue";
import ProjectDeleteDialog from "./ProjectDeleteDialog.vue";
import ProjectEditDialog from "./ProjectEditDialog.vue";
import SessionRenameDialog from "./SessionRenameDialog.vue";
import TooltipButton from "./TooltipButton.vue";
import {
  IconArchive,
  IconArchiveRestore,
  IconArrowUpDown,
  IconBranch,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconCircleAlert,
  IconCopy,
  IconFolder,
  IconMore,
  IconNewProject,
  IconNewSession,
  IconPencil,
  IconPin,
  IconPlug,
  IconSettings,
  IconSidebar,
  IconStar,
  IconTrash,
  IconX,
} from "../lib/icons";

type ProjectEntry = {
  path: string;
  key: string;
  name: string;
  sessions: SessionSummary[];
  open: boolean;
  active: boolean;
  meta: ProjectMeta;
  /** Best-effort git branch from the project workspace, if known. */
  branch?: string;
};

const VIEWPORT_PADDING = 8;

/** Private MIME so a sidebar session drag is never mistaken for an OS file drop. */
const SESSION_DRAG_MIME = "application/x-dcode-session";

/** Default number of most-recent sessions shown per project group before the rest fold. */
const MAX_VISIBLE_SESSIONS = 10;

const SESSION_SORT_OPTIONS = ["recent", "oldest", "name", "created"] as const;

type SidebarResizeState = {
  pointerId: number;
  startX: number;
  startWidth: number;
  currentWidth: number;
  frame: number;
  handle: HTMLDivElement;
};

type ProjectReorderPointerState = {
  pointerId: number;
  projectKey: string;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  armed: boolean;
  dropKey: string | null;
  dropTop: number;
  dropHeight: number;
  insertAfter: boolean;
  onMove: (event: PointerEvent) => void;
  onUp: (event: PointerEvent) => void;
  onCancel: (event: PointerEvent) => void;
};

function clearSidebarResizeStyles(): void {
  document.documentElement.removeAttribute("data-sidebar-resizing");
}

function projectName(path: string, fallback?: string): string {
  if (fallback?.trim()) return fallback.trim();
  const clean = path.replace(/[\\/]+$/, "");
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function timestamp(value?: string): number {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalTimestamp(value?: string): number | null {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function projectMetaFor(
  path: string,
  projectMeta: Record<string, ProjectMeta>,
): ProjectMeta {
  return projectMeta[normalizeProjectPath(path) || path] ?? projectMeta[path] ?? {};
}

function projectDomId(path: string): string {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `sidebar-project-${(hash >>> 0).toString(36)}`;
}

function firstSessionDate(
  sessions: SessionSummary[],
  field: "createdAt" | "updatedAt",
): number | null {
  const values = sessions
    .map((session) => timestamp(session[field]))
    .filter((value) => value > 0);
  return values.length ? Math.min(...values) : null;
}

function lastSessionDate(
  sessions: SessionSummary[],
  field: "createdAt" | "updatedAt",
): number | null {
  const values = sessions
    .map((session) => timestamp(session[field]))
    .filter((value) => value > 0);
  return values.length ? Math.max(...values) : null;
}

function compareOptionalDate(
  a: number | null,
  b: number | null,
  descending: boolean,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return descending ? b - a : a - b;
}

const props = withDefaults(
  defineProps<{
    sidebarToggleShortcut: string;
    sidebarWidth: number;
    /** Live three-column budget: the upper bound a resize may land on. */
    widthMax?: number;
  }>(),
  { widthMax: SIDEBAR_WIDTH_MAX },
);

const emit = defineEmits<{
  "toggle-sidebar": [];
  "width-change": [width: number];
  "width-commit": [width: number];
  /** A drag that previewed below the collapse threshold yields the column. */
  "resize-collapse": [];
  animationend: [event: AnimationEvent];
}>();

const { t, te } = useI18n();

/** vue-i18n has no `defaultValue`; probe the key and fall back to the literal. */
function tt(key: string, fallback: string, named?: Record<string, unknown>): string {
  return te(key) ? t(key, named ?? {}) : fallback;
}

const store = useAppStore();

const sessions = computed(() => store.appState?.sessions ?? []);
const activeSessionId = computed(() => store.appState?.activeSessionId);
const selectingSessionId = computed(() => store.appState?.selectingSessionId);
const workspace = computed(() => store.appState?.workspace);
const openProjects = computed(() => store.appState?.openProjects ?? []);
const openProjectPathsState = computed(() => store.appState?.openProjectPaths ?? []);
const activeProjectPathState = computed(() => store.appState?.activeProjectPath);
const projectMeta = computed(() => store.appState?.projectMeta ?? {});
const projectCollapsed = computed(() => store.appState?.projectCollapsed ?? {});
const sessionMeta = computed(() => store.appState?.sessionMeta ?? {});
 // The `??` fallback is an addition here: `appState` is a shallowRef that is
 // undefined until the shell's first state push, where a store-backed read
 // always had a value. `as const` keeps the literal's `sort` narrowed to
// `"recent"` instead of widening the whole computed to `string`.
const sessionView = computed(
  () => store.appState?.sessionView ?? { sort: "recent" as const, archived: false },
);
const projectSort = computed<ProjectSort>(() => store.appState?.projectSort ?? "recent");
const runningSessions = computed(() => store.appState?.runningSessions ?? {});
const sessionOutcomes = computed(() => store.appState?.sessionOutcomes ?? {});
const pendingPermissions = computed(() => store.appState?.pendingPermissions ?? {});
const page = computed(() => store.appState?.page ?? "chat");
const settings = computed(() => store.appState?.settings);
const version = computed(() => store.appState?.version);

const update = useUpdateState();

const sortOpen = ref(false);
const sessionMenu = ref<string | null>(null);
const renameFor = ref<SessionSummary | null>(null);
const editProjectFor = ref<ProjectEntry | null>(null);
const deleteProjectFor = ref<ProjectEntry | null>(null);
// Which row menu item is armed for its second, confirming click.
const { armed: armedDelete, setArmed: setArmedDelete } = useArmedDelete();
const projectMenu = ref<string | null>(null);
const sectionMenu = ref<"sessions" | "projects" | null>(null);
const menuPosition = ref<{ top: number; left: number } | null>(null);
const {
  card: sessionHoverCard,
  show: revealSessionHoverCard,
  hide: hideSessionHoverCard,
  scheduleHide: scheduleSessionHoverCardHide,
  keepVisible: keepSessionHoverCardVisible,
} = useSessionHoverCard();
const expandedProjectSessions = ref<Record<string, boolean>>({});
const draggingSessionId = ref<string | null>(null);
const dropProjectKey = ref<string | null>(null);
const projectsDropActive = ref(false);
const sidebarResizing = ref(false);
const draggingProjectKey = ref<string | null>(null);
const dropIndicator = ref<{ key: string; insertAfter: boolean } | null>(null);
const windowFocused = ref(true);

const menuTriggerRef = ref<HTMLButtonElement | null>(null);
const menuFirstItemRef = ref<HTMLButtonElement | null>(null);
const sidebarResizeRef = ref<SidebarResizeState | null>(null);
const projectReorderRef = ref<ProjectReorderPointerState | null>(null);
/** A title click that follows a reorder drag must not also toggle the group. */
let suppressProjectTitleClick = false;
let sessionPrefetchTimer: number | undefined;

/* ------------------------------------------------------------------ */
/* Sidebar resize                                                      */
/* ------------------------------------------------------------------ */

function finishSidebarResize(cancelled: boolean, collapse = false): void {
  const state = sidebarResizeRef.value;
  if (!state) return;
  if (collapse) {
    // Keep the previewed width for the exit animation and persist nothing:
    // the shell restores the preferred expanded width on reopen.
  } else if (cancelled) {
    emit("width-change", state.startWidth);
  } else {
    emit("width-change", state.currentWidth);
    emit("width-commit", state.currentWidth);
  }
  sidebarResizeRef.value = null;
  if (state.frame) cancelAnimationFrame(state.frame);
  clearSidebarResizeStyles();
  if (state.handle.hasPointerCapture(state.pointerId)) {
    state.handle.releasePointerCapture(state.pointerId);
  }
  sidebarResizing.value = false;
  if (collapse) emit("resize-collapse");
}

function startSidebarResize(event: PointerEvent): void {
  if (event.button !== 0 || sidebarResizeRef.value) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget as HTMLDivElement;
  handle.focus({ preventScroll: true });
  // Anchor to the rendered width so pressing the handle never resizes the
  // column; the live budget only limits where the gesture may land.
  const startWidth = clampSidebarWidth(props.sidebarWidth);
  sidebarResizeRef.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth,
    currentWidth: startWidth,
    frame: 0,
    handle,
  };
  sidebarResizing.value = true;
  document.documentElement.setAttribute("data-sidebar-resizing", "true");
  handle.setPointerCapture(event.pointerId);
}

function moveSidebarResize(event: PointerEvent): void {
  const state = sidebarResizeRef.value;
  if (!state || state.pointerId !== event.pointerId) return;
  const result = sidebarPointerResize({
    startWidth: state.startWidth,
    deltaX: event.clientX - state.startX,
    maxWidth: props.widthMax,
  });
  if (result.type === "collapse") {
    finishSidebarResize(true, true);
    return;
  }
  state.currentWidth = result.width;
  if (state.frame) return;
  state.frame = requestAnimationFrame(() => {
    if (sidebarResizeRef.value !== state) return;
    state.frame = 0;
    emit("width-change", state.currentWidth);
  });
}

function endSidebarResize(event: PointerEvent): void {
  if (sidebarResizeRef.value?.pointerId !== event.pointerId) return;
  finishSidebarResize(false);
}

function cancelSidebarResize(event: PointerEvent): void {
  if (sidebarResizeRef.value?.pointerId !== event.pointerId) return;
  finishSidebarResize(true);
}

function handleSidebarResizeKeyDown(event: KeyboardEvent): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const currentWidth = clampSidebarWidth(props.sidebarWidth, props.widthMax);
  const nextWidth =
    event.key === "Home"
      ? SIDEBAR_WIDTH_MIN
      : event.key === "End"
        ? clampSidebarWidth(props.widthMax, props.widthMax)
        : clampSidebarWidth(
            currentWidth + (event.key === "ArrowRight" ? SIDEBAR_RESIZE_STEP : -SIDEBAR_RESIZE_STEP),
            props.widthMax,
          );
  if (nextWidth === currentWidth) return;
  emit("width-commit", nextWidth);
}

/**
 * Double-click reset: the shell's default width, clamped by the live
 * three-column budget. A pointer gesture that is somehow still open is
 * dropped first so its release cannot overwrite the reset.
 */
function resetSidebarWidth(): void {
  if (sidebarResizeRef.value) finishSidebarResize(true);
  emit("width-commit", sidebarResetWidth(props.widthMax));
}

/* ------------------------------------------------------------------ */
/* Derived view state                                                  */
/* ------------------------------------------------------------------ */

const showArchived = computed(() => sessionView.value.archived);
const sessionSort = computed<SessionSort>(() => sessionView.value.sort);
const displaySessionSort = computed<Exclude<SessionSort, "manual">>(() =>
  sessionSort.value === "manual" ? "recent" : sessionSort.value,
);
const displayProjectSort = computed<ProjectSort>(() => projectSort.value);
const activeProjectPath = computed(() =>
  normalizeProjectPath(activeProjectPathState.value ?? workspace.value?.path),
);
const selectedSessionId = computed(
  () => selectingSessionId.value ?? activeSessionId.value,
);
const openProjectPaths = computed(() =>
  openProjectPathsState.value
    .map((path) => normalizeProjectPath(path))
    .filter((path): path is string => Boolean(path)),
);

const updateReady = computed(
  () => update.value?.status === "available" || update.value?.status === "downloaded",
);
const appVersion = computed(
  () => update.value?.currentVersion || version.value?.version || "",
);
const buildLabel = computed(() => {
  if (updateReady.value) return `v${update.value?.availableVersion ?? appVersion.value}`;
  if (update.value?.status === "checking") return t("updates.checking");
  return appVersion.value ? `v${appVersion.value}` : t("nav.buildUnknown");
});
// The tooltip names what a click will do. A disabled install has no check to
// offer, so the chip advertises nothing rather than inviting a dead click.
const buildTitle = computed(() =>
  updateReady.value
    ? t("updates.available", { version: update.value?.availableVersion ?? "" })
    : update.value?.mode === "disabled"
      ? buildLabel.value
      : t("nav.checkForUpdates"),
);

function taskTitle(title?: string | null): string {
  const value = (title || "").trim();
  return isDefaultSessionTitle(value) ? t("chat.untitledTask") : value;
}

function sortOptionLabel(value: (typeof SESSION_SORT_OPTIONS)[number]): string {
  if (value === "recent") return tt("nav.sortRecent", "Recently updated");
  if (value === "oldest") return tt("nav.sortOldest", "Oldest first");
  if (value === "name") return tt("nav.sortName", "Name");
  return tt("nav.sortCreated", "Created date");
}

function sessionStatusLabel(status: SidebarSessionStatus): string {
  const labelKey =
    status === "running"
      ? "nav.sessionRunning"
      : status === "selected"
        ? "nav.sessionSelected"
        : status === "completed"
          ? "nav.sessionCompleted"
          : status === "failed"
            ? "nav.sessionFailed"
            : "nav.sessionPermission";
  const fallback =
    status === "running"
      ? "In progress"
      : status === "selected"
        ? "Selected"
        : status === "completed"
          ? "Completed"
          : status === "failed"
            ? "Failed"
            : "Permission required";
  return tt(labelKey, fallback);
}

const filtered = computed(() => {
  // Empty sessions are durable sidebar rows now. Their message count, not their
  // title, controls New Task reuse, so a manual rename never changes the
  // empty-slot behavior.
  return showArchived.value
    ? sessions.value
    : sessions.value.filter(
        (session) => !sessionArchived(session, sessionMeta.value[session.id]),
      );
});

function compareSessions(a: SessionSummary, b: SessionSummary): number {
  const aMeta = sessionMeta.value[a.id] ?? {};
  const bMeta = sessionMeta.value[b.id] ?? {};
  const archiveOrder = Number(sessionArchived(a, aMeta)) - Number(sessionArchived(b, bMeta));
  if (archiveOrder !== 0) return archiveOrder;
  const pinOrder = Number(sessionPinned(b, bMeta)) - Number(sessionPinned(a, aMeta));
  if (pinOrder !== 0) return pinOrder;
  const sort = displaySessionSort.value;
  if (sort === "name") {
    const byName = taskTitle(a.title).localeCompare(taskTitle(b.title), undefined, {
      sensitivity: "base",
    });
    if (byName !== 0) return byName;
  } else if (sort === "oldest") {
    const byCreated = compareOptionalDate(
      optionalTimestamp(a.createdAt),
      optionalTimestamp(b.createdAt),
      false,
    );
    if (byCreated !== 0) return byCreated;
  } else if (sort === "created") {
    const byCreated = compareOptionalDate(
      optionalTimestamp(a.createdAt),
      optionalTimestamp(b.createdAt),
      true,
    );
    if (byCreated !== 0) return byCreated;
  } else {
    const byRecent = compareOptionalDate(
      optionalTimestamp(a.updatedAt),
      optionalTimestamp(b.updatedAt),
      true,
    );
    if (byRecent !== 0) return byRecent;
  }
  return a.id.localeCompare(b.id);
}

const pinnedSessions = computed(() =>
  getGlobalPinnedSessions(
    filtered.value,
    sessionMeta.value,
    projectMeta.value,
    showArchived.value,
  ).sort(compareSessions),
);
const pinnedSessionIds = computed(
  () => new Set(pinnedSessions.value.map((session) => session.id)),
);

const projectEntries = computed<ProjectEntry[]>(() => {
  const byPath = new Map<string, ProjectEntry>();
  const add = (rawPath: string, name?: string, branch?: string, open = false) => {
    const normalized = normalizeProjectPath(rawPath);
    if (!normalized) return;
    const existing = byPath.get(normalized);
    if (existing) {
      existing.open ||= open;
      if (name && existing.name === projectName(existing.path)) existing.name = name;
      if (branch && !existing.branch) existing.branch = branch;
      return;
    }
    const meta = projectMetaFor(rawPath, projectMeta.value);
    byPath.set(normalized, {
      path: rawPath,
      key: normalized,
      name: projectName(rawPath, meta.name ?? name),
      sessions: [],
      open,
      active: normalized === activeProjectPath.value,
      meta,
      branch,
    });
  };
  for (const path of openProjectPaths.value) {
    const record = openProjects.value.find(
      (project) => normalizeProjectPath(project.path) === path,
    );
    add(path, record?.name, record?.branch, true);
  }
  if (workspace.value?.path) {
    add(workspace.value.path, workspace.value.name, workspace.value.branch, true);
  }
  for (const session of filtered.value) {
    const sessionPath = normalizeProjectPath(session.projectPath);
    if (!sessionPath) continue;
    // A closed project remains discoverable in Projects, but its historical
    // sessions must not recreate a sidebar tab that the user just closed.
    const entry = byPath.get(sessionPath);
    if (entry) entry.sessions.push(session);
  }
  const result = [...byPath.values()].filter(
    (entry) => showArchived.value || !entry.meta.archived,
  );
  for (const entry of result) entry.sessions.sort(compareSessions);
  result.sort((a, b) => {
    const archiveOrder = Number(!!a.meta.archived) - Number(!!b.meta.archived);
    if (archiveOrder !== 0) return archiveOrder;
    const pinOrder = Number(!!b.meta.pinned) - Number(!!a.meta.pinned);
    if (pinOrder !== 0) return pinOrder;
    const sort = displayProjectSort.value;
    if (sort === "manual") {
      const byOrder =
        (a.meta.order ?? Number.MAX_SAFE_INTEGER) -
        (b.meta.order ?? Number.MAX_SAFE_INTEGER);
      if (byOrder !== 0) return byOrder;
    } else if (sort === "name") {
      const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      if (byName !== 0) return byName;
    } else if (sort === "oldest" || sort === "created") {
      const dateForProject = sort === "oldest" ? firstSessionDate : lastSessionDate;
      const byCreated = compareOptionalDate(
        dateForProject(a.sessions, "createdAt"),
        dateForProject(b.sessions, "createdAt"),
        sort === "created",
      );
      if (byCreated !== 0) return byCreated;
    } else {
      const byRecent = compareOptionalDate(
        lastSessionDate(a.sessions, "updatedAt"),
        lastSessionDate(b.sessions, "updatedAt"),
        true,
      );
      if (byRecent !== 0) return byRecent;
    }
    return a.key.localeCompare(b.key);
  });
  return result;
});

// Look up project entries by normalized path so session rows can fetch the
// workspace name (and any other project metadata) for the hover card.
const projectEntriesByPath = computed(() => {
  const map = new Map<string, ProjectEntry>();
  for (const entry of projectEntries.value) map.set(entry.key, entry);
  return map;
});

const temporarySessions = computed(() =>
  filtered.value
    .filter((session) => !normalizeProjectPath(session.projectPath))
    .sort(compareSessions),
);
const temporarySessionHistory = computed(() =>
  temporarySessions.value.filter((session) => !pinnedSessionIds.value.has(session.id)),
);

/* ------------------------------------------------------------------ */
/* Session rows                                                        */
/* ------------------------------------------------------------------ */

type SessionRowModel = {
  active: boolean;
  archived: boolean;
  pinned: boolean;
  running: boolean;
  status: SidebarSessionStatus | null;
  temporary: boolean;
  global: boolean;
  owningProject: string;
  title: string;
};

type SessionRowView = {
  session: SessionSummary;
  model: SessionRowModel;
};

type TimeGroupName = ReturnType<typeof groupSidebarSessionsByTime>[number]["group"];

const TIME_GROUP_KEYS: Record<TimeGroupName, string> = {
  today: "nav.timeGroupToday",
  yesterday: "nav.timeGroupYesterday",
  thisWeek: "nav.timeGroupThisWeek",
  older14d: "nav.timeGroupOlder14d",
  archived: "nav.timeGroupArchived",
};

function sessionRow(
  session: SessionSummary,
  options?: { temporary?: boolean; global?: boolean },
): SessionRowModel {
  const meta = sessionMeta.value[session.id] ?? {};
  const normalizedProjectPath = normalizeProjectPath(session.projectPath);
  const temporary = options?.temporary ?? !normalizedProjectPath;
  const global = options?.global ?? false;
  const owningProject =
    global && normalizedProjectPath
      ? projectEntriesByPath.value.get(normalizedProjectPath)?.name ??
        projectName(
          normalizedProjectPath,
          projectMetaFor(normalizedProjectPath, projectMeta.value).name,
        )
      : t("nav.hoverCardTemporarySpace");
  const active = page.value === "chat" && selectedSessionId.value === session.id;
  const running = Boolean(runningSessions.value[session.id]);
  const hasPendingPermission =
    (pendingPermissions.value[session.id]?.length ?? 0) > 0;
  return {
    active,
    archived: sessionArchived(session, meta),
    pinned: sessionPinned(session, meta),
    running,
    status: sidebarSessionStatus({
      running,
      selected: active,
      outcome: sessionOutcomes.value[session.id],
      hasPendingPermission,
    }),
    temporary,
    global,
    owningProject,
    title: taskTitle(session.title),
  };
}

const pinnedRows = computed<SessionRowView[]>(() =>
  pinnedSessions.value.map((session) => ({
    session,
    model: sessionRow(session, { global: true }),
  })),
);

const temporaryRows = computed<SessionRowView[]>(() =>
  temporarySessionHistory.value.map((session) => ({
    session,
    model: sessionRow(session, { temporary: true }),
  })),
);

type ProjectGroupView = {
  entry: ProjectEntry;
  collapsedProject: boolean;
  projectId: string;
  isMenuOpen: boolean;
  hiddenCount: number;
  timeGroups: Array<{
    group: TimeGroupName;
    headerKey: string;
    rows: SessionRowView[];
  }>;
};

const projectGroups = computed<ProjectGroupView[]>(() =>
  projectEntries.value.map((entry) => {
    const collapsedProject =
      entry.meta.collapsed ?? projectCollapsed.value[entry.key] ?? false;
    const sessionsExpanded = expandedProjectSessions.value[entry.key] ?? false;
    const history = entry.sessions.filter(
      (session) => !pinnedSessionIds.value.has(session.id),
    );
    // Show the most recent MAX_VISIBLE_SESSIONS rows by default; the remaining
    // sessions stay folded behind the same load-more affordance used for the
    // time-grouped overflow and expand on click.
    const visibleSessions = sessionsExpanded
      ? history
      : history.slice(0, MAX_VISIBLE_SESSIONS);
    return {
      entry,
      collapsedProject,
      projectId: projectDomId(entry.key),
      isMenuOpen: projectMenu.value === entry.key,
      hiddenCount: history.length - visibleSessions.length,
      timeGroups: groupSidebarSessionsByTime(visibleSessions).map((group) => ({
        group: group.group,
        headerKey: TIME_GROUP_KEYS[group.group],
        rows: group.sessions.map((session) => ({
          session,
          model: sessionRow(session),
        })),
      })),
    };
  }),
);

const menuSession = computed(() =>
  sessionMenu.value
    ? sessions.value.find((item) => item.id === sessionMenu.value)
    : undefined,
);
const menuProjectEntry = computed(() =>
  projectMenu.value
    ? projectEntries.value.find((item) => item.key === projectMenu.value)
    : undefined,
);
const floatingMenuVisible = computed(
  () =>
    Boolean(menuPosition.value) &&
    Boolean(sectionMenu.value || sortOpen.value || menuSession.value || menuProjectEntry.value),
);

/**
 * The menu is `position: fixed`, so both offsets need units. Vue assigns
 * `style.top = value` verbatim and CSSOM drops a unitless length without
 * complaint, which would leave the menu at its static position.
 */
const menuStyle = computed(() =>
  menuPosition.value
    ? { top: `${menuPosition.value.top}px`, left: `${menuPosition.value.left}px` }
    : undefined,
);

const editProjectTarget = computed(() => {
  const entry = editProjectFor.value;
  return entry ? { name: entry.name, path: entry.path } : null;
});
const deleteProjectTarget = computed(() => {
  const entry = deleteProjectFor.value;
  return entry
    ? { name: entry.name, path: entry.path, sessionCount: entry.sessions.length }
    : null;
});
const deleteProjectRunningIds = computed(() =>
  (deleteProjectFor.value?.sessions ?? [])
    .filter((session) => runningSessions.value[session.id] === true)
    .map((session) => session.id),
);

/* ------------------------------------------------------------------ */
/* Menus                                                               */
/* ------------------------------------------------------------------ */

function closeMenus(restoreFocus = true): void {
  const trigger = menuTriggerRef.value;
  sortOpen.value = false;
  sessionMenu.value = null;
  projectMenu.value = null;
  sectionMenu.value = null;
  menuPosition.value = null;
  if (restoreFocus && trigger) requestAnimationFrame(() => trigger.focus());
}

function placeMenu(event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  menuPosition.value = {
    top: Math.max(VIEWPORT_PADDING, Math.min(rect.bottom + 4, window.innerHeight - 220)),
    left: Math.max(VIEWPORT_PADDING, rect.right + 4),
  };
}

// Body-level sidebar menus always anchor their left edge to the right side of
// the trigger or pointer; they never flip to the left at the viewport edge.
function placeMenuAtPoint(x: number, y: number): void {
  menuPosition.value = {
    top: Math.max(VIEWPORT_PADDING, Math.min(y + 4, window.innerHeight - 220)),
    left: Math.max(VIEWPORT_PADDING, x + 4),
  };
}

function openSessionRowMenu(sessionId: string, trigger: HTMLButtonElement | null): void {
  menuTriggerRef.value = trigger;
  sortOpen.value = false;
  projectMenu.value = null;
  sectionMenu.value = null;
  hideSessionHoverCard();
  sessionMenu.value = sessionId;
}

function openProjectRowMenu(projectKey: string, trigger: HTMLButtonElement | null): void {
  menuTriggerRef.value = trigger;
  sortOpen.value = false;
  sessionMenu.value = null;
  sectionMenu.value = null;
  projectMenu.value = projectKey;
}

function openSectionMenu(section: "sessions" | "projects", x: number, y: number): void {
  menuTriggerRef.value = null;
  sortOpen.value = false;
  sessionMenu.value = null;
  projectMenu.value = null;
  placeMenuAtPoint(x, y);
  sectionMenu.value = section;
}

function setFirstMenuItem(element: unknown): void {
  menuFirstItemRef.value = (element as HTMLButtonElement | null) ?? null;
}

function onMenuKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    closeMenus();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = Array.from(
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)',
    ),
  );
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}

/* ------------------------------------------------------------------ */
/* Project reorder (press-and-move on a group title)                    */
/* ------------------------------------------------------------------ */

function finishProjectReorderPress(opts?: { keepClickSuppressed?: boolean }): void {
  const state = projectReorderRef.value;
  if (state) {
    window.removeEventListener("pointermove", state.onMove, true);
    window.removeEventListener("pointerup", state.onUp, true);
    window.removeEventListener("pointercancel", state.onCancel, true);
    projectReorderRef.value = null;
  }
  if (!opts?.keepClickSuppressed) suppressProjectTitleClick = false;
  draggingProjectKey.value = null;
  dropIndicator.value = null;
  document.documentElement.removeAttribute("data-project-reordering");
}

function reorderProjectEntries(
  sourceKey: string,
  targetKey: string,
  insertAfter: boolean,
): void {
  if (!sourceKey || !targetKey || sourceKey === targetKey) return;
  const keys = projectEntries.value.map((entry) => entry.key);
  const sourceIndex = keys.indexOf(sourceKey);
  const targetIndex = keys.indexOf(targetKey);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const source = projectEntries.value[sourceIndex];
  const target = projectEntries.value[targetIndex];
  if (!sameProjectReorderBucket(source.meta, target.meta)) return;
  keys.splice(sourceIndex, 1);
  const nextTargetIndex = keys.indexOf(targetKey) + (insertAfter ? 1 : 0);
  keys.splice(nextTargetIndex, 0, sourceKey);
  store.appState?.reorderProjects(keys);
}

function beginProjectReorderPress(event: PointerEvent, projectKey: string): void {
  if (event.button !== 0 || event.pointerType === "touch" || projectReorderRef.value) {
    return;
  }

  const onMove = (moveEvent: PointerEvent) => {
    const current = projectReorderRef.value;
    if (!current || current.pointerId !== moveEvent.pointerId) return;
    current.lastX = moveEvent.clientX;
    current.lastY = moveEvent.clientY;
    if (!current.armed) {
      if (
        !projectReorderShouldArm(
          moveEvent.clientX - current.startX,
          moveEvent.clientY - current.startY,
        )
      ) {
        return;
      }
      current.armed = true;
      suppressProjectTitleClick = true;
      document.documentElement.setAttribute("data-project-reordering", "true");
      draggingProjectKey.value = current.projectKey;
    }
    moveEvent.preventDefault();
    const target = projectGroupKeyFromPoint(moveEvent.clientX, moveEvent.clientY);
    const source = projectEntries.value.find((entry) => entry.key === current.projectKey);
    const destination = target
      ? projectEntries.value.find((entry) => entry.key === target.key)
      : undefined;
    if (
      target &&
      source &&
      destination &&
      target.key !== current.projectKey &&
      sameProjectReorderBucket(source.meta, destination.meta)
    ) {
      const insertAfter = projectReorderInsertAfter(
        moveEvent.clientY,
        target.top,
        target.height,
      );
      current.dropKey = target.key;
      current.dropTop = target.top;
      current.dropHeight = target.height;
      current.insertAfter = insertAfter;
      dropIndicator.value = { key: target.key, insertAfter };
    } else {
      current.dropKey = null;
      dropIndicator.value = null;
    }
  };

  const onUp = (upEvent: PointerEvent) => {
    const current = projectReorderRef.value;
    if (!current || current.pointerId !== upEvent.pointerId) return;
    if (current.armed) {
      upEvent.preventDefault();
      if (current.dropKey) {
        reorderProjectEntries(current.projectKey, current.dropKey, current.insertAfter);
      }
      finishProjectReorderPress({ keepClickSuppressed: true });
      return;
    }
    finishProjectReorderPress();
  };

  const onCancel = (cancelEvent: PointerEvent) => {
    const current = projectReorderRef.value;
    if (!current || current.pointerId !== cancelEvent.pointerId) return;
    finishProjectReorderPress();
  };

  projectReorderRef.value = {
    pointerId: event.pointerId,
    projectKey,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    armed: false,
    dropKey: null,
    dropTop: 0,
    dropHeight: 0,
    insertAfter: false,
    onMove,
    onUp,
    onCancel,
  };
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);
}

function moveProjectWithKeyboard(event: KeyboardEvent, projectKey: string): void {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  const index = projectEntries.value.findIndex((entry) => entry.key === projectKey);
  const target = projectEntries.value[index + (event.key === "ArrowUp" ? -1 : 1)];
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  reorderProjectEntries(projectKey, target.key, event.key === "ArrowDown");
}

function onProjectTitleDragStart(event: DragEvent): void {
  event.preventDefault();
}

function onProjectTitleClick(group: ProjectGroupView): void {
  if (suppressProjectTitleClick) {
    suppressProjectTitleClick = false;
    return;
  }
  void (async () => {
    if (!group.entry.active && !(await selectProject(group.entry.path))) return;
    setCollapsed(group.entry.path, !group.collapsedProject);
  })();
}

function onProjectHeaderClick(event: MouseEvent, group: ProjectGroupView): void {
  // Same one-target rule as a session row: the header's own controls stay the
  // only spelled-out targets, so the gutter next to a hidden control still
  // activates and toggles the group.
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, [data-action]")) return;
  void (async () => {
    if (!group.entry.active && !(await selectProject(group.entry.path))) return;
    setCollapsed(group.entry.path, !group.collapsedProject);
  })();
}

function onProjectHeaderContextMenu(event: MouseEvent, entry: ProjectEntry): void {
  event.preventDefault();
  event.stopPropagation();
  if (projectReorderRef.value) return;
  placeMenuAtPoint(event.clientX, event.clientY);
  openProjectRowMenu(
    entry.key,
    (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(".project-more"),
  );
}

/* ------------------------------------------------------------------ */
/* Hover card                                                          */
/* ------------------------------------------------------------------ */

function showSessionHoverCard(
  session: SessionSummary,
  target: HTMLElement,
  temporary: boolean,
): void {
  const projectPath = session.projectPath ?? "";
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  const entry = projectEntriesByPath.value.get(normalizedProjectPath ?? "");
  revealSessionHoverCard({
    session: { ...session, title: taskTitle(session.title) },
    target,
    temporary,
    space: temporary
      ? t("nav.hoverCardTemporarySpace")
      : entry?.name ?? projectName(projectPath),
    branch: entry?.branch,
  });
}

function onSessionRowEnter(
  event: MouseEvent,
  session: SessionSummary,
  temporary: boolean,
): void {
  showSessionHoverCard(session, event.currentTarget as HTMLElement, temporary);
}

function onSessionRowFocusIn(
  event: FocusEvent,
  session: SessionSummary,
  temporary: boolean,
): void {
  showSessionHoverCard(session, event.currentTarget as HTMLElement, temporary);
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function reportError(error: unknown): void {
  store.appState?.showToast(error instanceof Error ? error.message : String(error), {
    variant: "error",
  });
}

function focusComposer(): void {
  requestAnimationFrame(() => {
    document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus();
  });
}

async function selectProject(path: string): Promise<boolean> {
  const normalized = normalizeProjectPath(path);
  if (!normalized) return false;
  if (normalized === activeProjectPath.value) return true;
  try {
    return Boolean(await store.appState?.activateProject(path));
  } catch (error) {
    reportError(error);
    return false;
  }
}

async function selectProjectSession(session: SessionSummary): Promise<boolean> {
  try {
    await store.appState?.selectSession(session.id);
    focusComposer();
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
}

async function selectTemporarySession(sessionId: string): Promise<void> {
  try {
    await store.appState?.selectSession(sessionId);
    focusComposer();
  } catch (error) {
    reportError(error);
  }
}

function scheduleSessionPrefetch(sessionId: string): void {
  window.clearTimeout(sessionPrefetchTimer);
  sessionPrefetchTimer = window.setTimeout(() => {
    void store.appState?.prefetchSession(sessionId).catch(() => undefined);
  }, 120);
}

function cancelSessionPrefetch(): void {
  window.clearTimeout(sessionPrefetchTimer);
  sessionPrefetchTimer = undefined;
}

async function openSessionFromHover(sessionId: string): Promise<void> {
  cancelSessionPrefetch();
  hideSessionHoverCard();
  try {
    // A dead reference must fail visibly instead of selecting an empty chat.
    // The store's session list is the cheapest complete existence signal; an
    // unknown id still gets one detail read so a stale list cannot block a
    // session that really exists.
    const known = sessions.value.some((session) => session.id === sessionId);
    if (!known) {
      const detail = await api.getSession(sessionId);
      if (!detail.session) {
        reportError(new Error(t("sessionCollaboration.sessionMissing")));
        return;
      }
    }
    await store.appState?.selectSession(sessionId);
    focusComposer();
  } catch (error) {
    reportError(error);
  }
}

function setCollapsed(path: string, value: boolean): void {
  const normalized = normalizeProjectPath(path) || path;
  store.appState?.setProjectCollapsed(normalized, value);
}

function setSort(next: SessionSort): void {
  store.appState?.setSessionSort(next);
  store.appState?.setProjectSort(next);
  closeMenus();
}

function toggleShowArchived(): void {
  store.appState?.setSessionArchiveVisibility(!showArchived.value);
  closeMenus();
}

function expandProjectSessions(projectKey: string): void {
  expandedProjectSessions.value = { ...expandedProjectSessions.value, [projectKey]: true };
}

function onSessionMainClick(row: SessionRowView): void {
  cancelSessionPrefetch();
  hideSessionHoverCard();
  void (row.model.temporary
    ? selectTemporarySession(row.session.id)
    : selectProjectSession(row.session));
}

function onSessionRowClick(event: MouseEvent, row: SessionRowView): void {
  // The row's own controls are the only click targets spelled out in markup; a
  // click on the row container or its gap to the actions column - including
  // where a hidden overflow control would sit - still opens the conversation
  // instead of dying on the wrapper.
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, [data-action]")) return;
  onSessionMainClick(row);
}

function onSessionRowContextMenu(event: MouseEvent, sessionId: string): void {
  event.preventDefault();
  event.stopPropagation();
  placeMenuAtPoint(event.clientX, event.clientY);
  openSessionRowMenu(
    sessionId,
    (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-action="session-menu"]',
    ),
  );
}

function onSessionMenuClick(event: MouseEvent, sessionId: string): void {
  event.stopPropagation();
  if (sessionMenu.value === sessionId) {
    closeMenus();
    return;
  }
  placeMenu(event);
  openSessionRowMenu(sessionId, event.currentTarget as HTMLButtonElement);
}

function onProjectMenuClick(event: MouseEvent, group: ProjectGroupView): void {
  event.stopPropagation();
  if (group.isMenuOpen) {
    closeMenus();
    return;
  }
  placeMenu(event);
  openProjectRowMenu(group.entry.key, event.currentTarget as HTMLButtonElement);
}

function onSortMenuClick(event: MouseEvent): void {
  if (sortOpen.value) {
    closeMenus();
    return;
  }
  placeMenu(event);
  menuTriggerRef.value = event.currentTarget as HTMLButtonElement;
  sessionMenu.value = null;
  projectMenu.value = null;
  sectionMenu.value = null;
  sortOpen.value = true;
}

/**
 * The menu items below open a dialog, and every one of them must read its
 * target *before* closing the menu. `closeMenus` clears the selection the
 * target is derived from, so reading `menuSession`/`menuProjectEntry`/
 * `sectionMenu` afterwards yields nothing and the dialog never opens.
 */
function openRenameDialog(): void {
  const session = menuSession.value;
  if (!session) return;
  closeMenus(false);
  renameFor.value = session;
}

function openEditProjectDialog(): void {
  const entry = menuProjectEntry.value;
  if (!entry) return;
  closeMenus(false);
  editProjectFor.value = entry;
}

function runSectionMenuAction(): void {
  const section = sectionMenu.value;
  closeMenus(false);
  if (section === "sessions") void createSession({ projectPath: null });
  else if (section === "projects") void openProjectPicker();
}

function toggleSessionPin(session: SessionSummary): void {
  store.appState?.toggleSessionPinned(session.id);
  closeMenus(false);
  // Pinning moves a row between lists, replacing its previous DOM node.
  requestAnimationFrame(() => {
    const row = document.querySelector<HTMLElement>(
      `[data-sidebar-session-row="${CSS.escape(session.id)}"] [data-action="session-menu"]`,
    );
    const target =
      row && !row.closest('[aria-hidden="true"]')
        ? row
        : document.querySelector<HTMLElement>('[data-action="session-sort"]');
    target?.focus();
  });
}

async function archiveSession(session: SessionSummary): Promise<void> {
  const archived = sessionArchived(session, sessionMeta.value[session.id]);
  const wasActive = activeSessionId.value === session.id;
  const next =
    !archived && wasActive
      ? session.projectPath
        ? projectEntries.value
            .find((entry) => entry.key === normalizeProjectPath(session.projectPath))
            ?.sessions.find(
              (item) =>
                item.id !== session.id &&
                !sessionArchived(item, sessionMeta.value[item.id]),
            )
        : temporarySessions.value.find(
            (item) =>
              item.id !== session.id &&
              !sessionArchived(item, sessionMeta.value[item.id]),
          )
      : undefined;
  try {
    closeMenus();
    if (archived) {
      store.appState?.restoreSession(session.id);
      return;
    }
    if (wasActive && next) {
      if (!(await selectProjectSession(next))) return;
      store.appState?.archiveSession(session.id);
      return;
    }
    if (wasActive) {
      // Archive first so an empty active slot is not reused as its own
      // replacement. Restore it if creating the fallback slot fails.
      store.appState?.archiveSession(session.id);
      try {
        await store.appState?.newSession({ projectPath: session.projectPath ?? null });
      } catch (error) {
        store.appState?.restoreSession(session.id);
        throw error;
      }
      return;
    }
    store.appState?.archiveSession(session.id);
  } catch (error) {
    reportError(error);
  }
}

async function deleteSession(session: SessionSummary): Promise<void> {
  closeMenus();
  const wasActive = activeSessionId.value === session.id;
  const sameScope = session.projectPath
    ? projectEntries.value.find(
        (entry) => entry.key === normalizeProjectPath(session.projectPath),
      )?.sessions ?? []
    : temporarySessions.value;
  const next = wasActive
    ? sameScope.find(
        (item) =>
          item.id !== session.id &&
          !sessionArchived(item, sessionMeta.value[item.id]),
      ) ??
      projectEntries.value
        .flatMap((entry) => entry.sessions)
        .find(
          (item) =>
            item.id !== session.id &&
            !sessionArchived(item, sessionMeta.value[item.id]),
        )
    : undefined;
  try {
    await store.appState?.deleteSession(session.id);
    if (wasActive) {
      if (next) await selectProjectSession(next);
      else await store.appState?.newSession({ projectPath: session.projectPath ?? null });
    }
  } catch (error) {
    reportError(error);
  }
}

/**
 * Two-step delete for one row's menu item. The first click arms the item and
 * relabels it; only the second click runs the delete, and the arm expires on
 * its own. The menu stays open between the two clicks.
 */
function requestDeleteSession(session: SessionSummary): void {
  if (armedDelete.value !== session.id) {
    setArmedDelete(session.id);
    return;
  }
  setArmedDelete(null);
  void deleteSession(session);
}

/** Menu items of different surfaces never share an armed key. */
function projectDeleteKey(entry: ProjectEntry): string {
  return `project:${entry.key}`;
}

/**
 * Two-step delete for a project row that keeps the running-task safety. The
 * second click deletes an idle project straight away; a project whose turn is
 * still live opens the dialog that names those sessions and stops them.
 */
async function requestDeleteProject(entry: ProjectEntry): Promise<void> {
  const key = projectDeleteKey(entry);
  if (armedDelete.value !== key) {
    setArmedDelete(key);
    return;
  }
  setArmedDelete(null);
  closeMenus(false);
  if (entry.sessions.some((session) => runningSessions.value[session.id] === true)) {
    deleteProjectFor.value = entry;
    return;
  }
  try {
    await store.appState?.deleteProject(entry.path);
    store.appState?.showToast(t("project.deleted", { name: entry.name }), {
      variant: "success",
    });
  } catch (error) {
    // The host refuses a project whose task started after this render.
    reportError(
      (error as { errorCode?: unknown } | null)?.errorCode === ErrorCodes.CONFLICT
        ? new Error(t("project.deleteRunningBlocked"))
        : error,
    );
  }
}

async function openProjectFolder(entry: ProjectEntry): Promise<void> {
  closeMenus(false);
  try {
    await api.openProjectFolder(entry.path);
  } catch (error) {
    reportError(error);
  }
}

async function forkSession(session: SessionSummary): Promise<void> {
  closeMenus(false);
  try {
    await store.appState?.forkSession(session.id);
    focusComposer();
  } catch (error) {
    reportError(error);
  }
}

async function copyConversationId(session: SessionSummary): Promise<void> {
  try {
    await navigator.clipboard.writeText(session.id);
    store.appState?.showToast(t("chat.copied"));
  } catch (error) {
    reportError(error);
  }
  closeMenus();
}

async function openSessionPath(session: SessionSummary): Promise<void> {
  closeMenus(false);
  try {
    await api.openSessionScratchPath(session.id);
  } catch (error) {
    reportError(error);
  }
}

function toggleProjectPin(entry: ProjectEntry): void {
  store.appState?.toggleProjectPinned(entry.path);
  closeMenus();
}

async function archiveProject(entry: ProjectEntry): Promise<void> {
  const archived = Boolean(entry.meta.archived);
  const wasActive = entry.active;
  const next = !archived
    ? projectEntries.value.find(
        (candidate) => candidate.key !== entry.key && !candidate.meta.archived,
      )
    : undefined;
  try {
    closeMenus();
    if (archived) {
      store.appState?.restoreProject(entry.path);
      return;
    }
    // Move the visible context before hiding the active project. This prevents
    // an archived, invisible project from remaining active.
    if (wasActive) {
      if (next) {
        if (!(await selectProject(next.path))) return;
      } else {
        await store.appState?.clearProject();
      }
    }
    store.appState?.archiveProject(entry.path);
  } catch (error) {
    reportError(error);
  }
}

async function closeProject(entry: ProjectEntry): Promise<void> {
  closeMenus();
  try {
    await store.appState?.closeProject(entry.path);
  } catch (error) {
    reportError(error);
  }
}

async function createSession(options?: { projectPath?: string | null }): Promise<void> {
  try {
    await store.appState?.newSession(options);
    focusComposer();
  } catch (error) {
    reportError(error);
  }
}

async function createProjectSession(path: string): Promise<void> {
  await createSession({ projectPath: path });
}

async function openProjectPicker(): Promise<void> {
  try {
    await store.appState?.openProject();
  } catch (error) {
    reportError(error);
  }
}

async function moveSessionToProject(
  sessionId: string,
  projectPath: string,
  projectName: string,
): Promise<void> {
  // A running turn owns the current project's instructions, tools, and working
  // directory; the host rejects the move as well.
  if (runningSessions.value[sessionId]) {
    store.appState?.showToast(
      t("nav.moveRunningSessionBlocked", {
        defaultValue: "Stop the running session before moving it.",
      }),
      { variant: "warning" },
    );
    return;
  }
  try {
    const moved = await store.appState?.moveSessionProject(sessionId, projectPath);
    if (!moved) {
      store.appState?.showToast(
        t("nav.moveSessionUnavailable", {
          defaultValue: "This session cannot move to that project.",
        }),
        { variant: "warning" },
      );
      return;
    }
    store.appState?.showToast(
      t("nav.sessionMoved", {
        name: projectName,
        defaultValue: "Moved to " + projectName,
      }),
      { variant: "success" },
    );
  } catch (error) {
    reportError(error);
  }
}

/* ------------------------------------------------------------------ */
/* Session drag between project groups                                 */
/* ------------------------------------------------------------------ */

function beginSessionDrag(event: DragEvent, sessionId: string): void {
  const transfer = event.dataTransfer;
  if (!transfer) return;
  transfer.effectAllowed = "move";
  transfer.setData(SESSION_DRAG_MIME, sessionId);
  transfer.setData("text/plain", sessionId);
  draggingSessionId.value = sessionId;
}

function endSessionDrag(): void {
  draggingSessionId.value = null;
  dropProjectKey.value = null;
}

function onSessionDragStart(event: DragEvent, sessionId: string, running: boolean): void {
  if (running) {
    event.preventDefault();
    return;
  }
  beginSessionDrag(event, sessionId);
}

function sessionIdFromDrag(dataTransfer: DataTransfer): string | null {
  try {
    return dataTransfer.getData(SESSION_DRAG_MIME) || null;
  } catch {
    return null;
  }
}

function sessionIdForDragOver(
  dataTransfer: DataTransfer,
  localSessionId: string | null,
): string | null {
  if (!Array.from(dataTransfer.types).includes(SESSION_DRAG_MIME)) return null;
  return sessionIdFromDrag(dataTransfer) ?? localSessionId;
}

// A project group accepts a session row from another group. The current group is
// not a drop target so a drag within one project is a no-op.
function onProjectDropTargetOver(event: DragEvent, entry: ProjectEntry): void {
  const transfer = event.dataTransfer;
  if (!transfer) return;
  const sessionId = sessionIdForDragOver(transfer, draggingSessionId.value);
  if (!sessionId) return;
  const dragged = sessions.value.find((item) => item.id === sessionId);
  if (!dragged || normalizeProjectPath(dragged.projectPath) === entry.key) return;
  event.preventDefault();
  transfer.dropEffect = "move";
  dropProjectKey.value = entry.key;
}

function onProjectDropTargetLeave(entry: ProjectEntry): void {
  if (dropProjectKey.value === entry.key) dropProjectKey.value = null;
}

function onProjectGroupDragLeave(event: DragEvent, entry: ProjectEntry): void {
  const related = event.relatedTarget;
  if (related instanceof Node && (event.currentTarget as HTMLElement).contains(related)) {
    return;
  }
  onProjectDropTargetLeave(entry);
}

function onProjectDropTargetDrop(event: DragEvent, entry: ProjectEntry): void {
  // The transfer payload is authoritative: a stale dragging id must never move
  // a session the user did not drag.
  const transfer = event.dataTransfer;
  const sessionId = transfer ? sessionIdFromDrag(transfer) : null;
  draggingSessionId.value = null;
  dropProjectKey.value = null;
  const dragged = sessionId
    ? sessions.value.find((item) => item.id === sessionId)
    : undefined;
  // Without a session payload this is a native folder drop for the projects
  // list, which the container handles.
  if (!dragged) return;
  event.preventDefault();
  event.stopPropagation();
  void moveSessionToProject(dragged.id, entry.path, entry.name);
}

/* ------------------------------------------------------------------ */
/* Native folder drops on the projects list                            */
/* ------------------------------------------------------------------ */

function onProjectsAreaDragEnter(event: DragEvent): void {
  if (event.dataTransfer && hasComposerFileDrag(event.dataTransfer)) {
    event.preventDefault();
  }
}

function onProjectsAreaDragOver(event: DragEvent): void {
  const transfer = event.dataTransfer;
  if (!transfer || !hasComposerFileDrag(transfer)) return;
  event.preventDefault();
  transfer.dropEffect = "copy";
  projectsDropActive.value = true;
}

function onProjectsAreaDragLeave(event: DragEvent): void {
  const related = event.relatedTarget;
  if (related instanceof Node && (event.currentTarget as HTMLElement).contains(related)) {
    return;
  }
  projectsDropActive.value = false;
}

async function onProjectsAreaDrop(event: DragEvent): Promise<void> {
  const transfer = event.dataTransfer;
  if (!transfer || !hasComposerFileDrag(transfer)) return;
  event.preventDefault();
  projectsDropActive.value = false;
  const directories = composerDropItems(transfer, api.getDroppedFilePath).filter(
    (item) => item.isDirectory && item.path,
  );
  if (!directories.length) {
    store.appState?.showToast(
      t("nav.dropFolderToAddProject", {
        defaultValue: "Drop a folder to add it as a project.",
      }),
      { variant: "warning" },
    );
    return;
  }
  for (const directory of directories) {
    try {
      await store.appState?.activateProject(directory.path!);
    } catch (error) {
      reportError(error);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Section scrollers                                                   */
/* ------------------------------------------------------------------ */

function onStandaloneScroll(): void {
  if (sessionMenu.value || projectMenu.value || sectionMenu.value || sortOpen.value) {
    closeMenus(false);
  }
}

function onStandaloneContextMenu(event: MouseEvent): void {
  if ((event.target as Element).closest?.("[data-sidebar-session-row]")) return;
  event.preventDefault();
  event.stopPropagation();
  openSectionMenu("sessions", event.clientX, event.clientY);
}

function onProjectsContextMenu(event: MouseEvent): void {
  if (
    (event.target as Element).closest?.(
      "[data-sidebar-session-row], [data-sidebar-project-group]",
    )
  ) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  openSectionMenu("projects", event.clientX, event.clientY);
}

function onSectionToolbarContextMenu(
  event: MouseEvent,
  section: "sessions" | "projects",
): void {
  event.preventDefault();
  event.stopPropagation();
  openSectionMenu(section, event.clientX, event.clientY);
}

/** Keep native drag/text selection from eating the secondary click path. */
function onSectionToolbarPointerDown(event: PointerEvent): void {
  if (event.button === 2) event.preventDefault();
}

/* ------------------------------------------------------------------ */
/* Footer + dialog plumbing                                            */
/* ------------------------------------------------------------------ */

function onBuildClick(): void {
  // A disabled install (development build, or a packaged build with no
  // configured repository) has nothing to check, so the version chip stays
  // inert and the version alone is the message.
  if (update.value?.mode === "disabled") return;
  if (updateReady.value) {
    store.appState?.setSettingsAnchor("updates.title");
    store.appState?.setSettingsTab("about");
    return;
  }
  void api.updatesCheck().catch(() => undefined);
}

function onPluginsClick(): void {
  if (page.value === "plugins") {
    if (store.appState?.canNavBack()) store.appState?.navBack();
    else store.appState?.setPage("chat");
    return;
  }
  store.appState?.setPage("plugins");
}

function onRenameSave(title: string): void {
  const target = renameFor.value;
  if (!target) return;
  void store.appState?.renameSession(target.id, title);
}

function onProjectSaved(group: ProjectGroupRecord): void {
  const entry = editProjectFor.value;
  if (!entry) return;
  store.appState?.renameProject(entry.path, group.name);
}

function onProjectDeleted(): void {
  const name = deleteProjectFor.value?.name;
  deleteProjectFor.value = null;
  if (name) {
    store.appState?.showToast(t("project.deleted", { name }), { variant: "success" });
  }
}

function refreshProjectAction(path: string): Promise<ProjectWorkspace | null> {
  return store.appState?.refreshProject(path) ?? Promise.resolve(null);
}

/* ------------------------------------------------------------------ */
/* Effects                                                             */
/* ------------------------------------------------------------------ */

function onWindowFocus(): void {
  windowFocused.value = document.hasFocus();
}

function onWindowBlur(): void {
  windowFocused.value = false;
}

function onGlobalKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (!projectReorderRef.value) return;
  event.preventDefault();
  finishProjectReorderPress();
}

onMounted(() => {
  window.addEventListener("focus", onWindowFocus);
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("keydown", onGlobalKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener("focus", onWindowFocus);
  window.removeEventListener("blur", onWindowBlur);
  window.removeEventListener("keydown", onGlobalKeyDown);
  finishProjectReorderPress();
  cancelSessionPrefetch();
  // A resize that is still in flight must not leave the width committed.
  const state = sidebarResizeRef.value;
  if (state) {
    if (state.frame) cancelAnimationFrame(state.frame);
    emit("width-change", state.startWidth);
    clearSidebarResizeStyles();
    sidebarResizeRef.value = null;
  }
});

// Escape cancels a resize in flight, wherever the pointer is.
watch(sidebarResizing, (resizing, _previous, onCleanup) => {
  if (!resizing) return;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    finishSidebarResize(true);
  };
  window.addEventListener("keydown", onKeyDown);
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));
});

// Dismissal for the body-level menus: outside pointer, Escape, or a viewport
// change. Right-click must not dismiss first; contextmenu handlers reopen.
watch(
  () => [sortOpen.value, sessionMenu.value, projectMenu.value, sectionMenu.value] as const,
  ([sort, session, project, section], _previous, onCleanup) => {
    if (!sort && !session && !project && !section) return;
    const onPointer = (event: PointerEvent) => {
      if (event.button === 2 || (event.pointerType === "mouse" && event.buttons === 2)) {
        return;
      }
      const target = event.target as Node;
      if (
        (target as Element)?.closest?.(
          ".sidebar-popover, .sidebar-row-menu, .notification-popover-portaled",
        )
      ) {
        return;
      }
      closeMenus(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenus();
    };
    const onViewportChange = () => closeMenus(false);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onViewportChange);
    onCleanup(() => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onViewportChange);
    });
  },
);

watch(
  () => [sessionMenu.value, projectMenu.value, sectionMenu.value, sortOpen.value] as const,
  () => {
    if (!sessionMenu.value && !projectMenu.value && !sectionMenu.value && !sortOpen.value) {
      return;
    }
    requestAnimationFrame(() => menuFirstItemRef.value?.focus());
  },
  { flush: "post" },
);

// A dragged row can unmount before its own `dragend` fires (sort refresh,
// archive, delete), which would otherwise leave the drag session and the group
// highlight active for the next, unrelated drag.
watch(draggingSessionId, (dragging, _previous, onCleanup) => {
  if (!dragging) return;
  const clearDragState = () => {
    draggingSessionId.value = null;
    dropProjectKey.value = null;
  };
  window.addEventListener("dragend", clearDragState);
  window.addEventListener("drop", clearDragState, true);
  onCleanup(() => {
    window.removeEventListener("dragend", clearDragState);
    window.removeEventListener("drop", clearDragState, true);
  });
});
</script>

<template>
  <aside
    class="sidebar sidebar-surface"
    :data-window-blur="windowFocused ? undefined : 'true'"
    @animationend="emit('animationend', $event)"
  >
    <div class="sidebar-header">
      <TooltipButton
        as="button"
        class="brand no-drag"
        data-nav="home"
        :label="t('nav.home')"
        :aria-label="t('nav.home')"
        @click="store.appState?.setPage('chat')"
      >
        <BrandLogo :size="20" />
        <span>{{ t("app.shellName") }}</span>
      </TooltipButton>
      <div class="sidebar-header-actions no-drag">
        <TooltipButton
          as="button"
          class="icon-btn icon-btn-square"
          :label="
            sidebarToggleShortcut
              ? `${t('nav.collapseSidebar')} (${sidebarToggleShortcut})`
              : t('nav.collapseSidebar')
          "
          :aria-label="t('nav.collapseSidebar')"
          :aria-expanded="true"
          data-nav="toggle-sidebar"
          @click="emit('toggle-sidebar')"
        >
          <IconSidebar :size="15" />
        </TooltipButton>
      </div>
    </div>

    <div class="sidebar-body no-drag">
      <section
        v-if="pinnedSessions.length > 0"
        class="sidebar-pinned-sessions"
        aria-labelledby="sidebar-pinned-label"
        data-sidebar-session-section="pinned"
      >
        <div class="sidebar-list-toolbar sidebar-list-toolbar-secondary">
          <span id="sidebar-pinned-label" class="sidebar-list-label">
            {{ t("nav.pinnedSessions") }}
          </span>
        </div>
        <div class="sidebar-session-group-body pinned" @scroll="closeMenus(false)">
          <div
            v-for="row in pinnedRows"
            :key="row.session.id"
            class="thread-item"
            :class="{
              active: row.model.active,
              archived: row.model.archived,
              'is-dragging': draggingSessionId === row.session.id,
            }"
            :data-sidebar-session-row="row.session.id"
            :draggable="!row.model.running"
            @dragstart="onSessionDragStart($event, row.session.id, row.model.running)"
            @dragend="endSessionDrag"
            @click="onSessionRowClick($event, row)"
            @contextmenu="onSessionRowContextMenu($event, row.session.id)"
          >
            <span
              v-if="row.model.status"
              class="thread-item-status"
              :class="row.model.status"
              :aria-label="sessionStatusLabel(row.model.status)"
              :title="sessionStatusLabel(row.model.status)"
            >
              <IconCheck
                v-if="row.model.status === 'completed'"
                :size="10"
                aria-hidden="true"
              />
              <IconCircleAlert
                v-if="row.model.status === 'failed'"
                :size="11"
                aria-hidden="true"
              />
            </span>
            <button
              type="button"
              class="thread-item-main"
              :aria-current="row.model.active ? 'page' : undefined"
              :aria-describedby="
                sessionHoverCard?.session.id === row.session.id
                  ? `session-hover-${row.session.id}`
                  : undefined
              "
              @pointerenter="scheduleSessionPrefetch(row.session.id)"
              @pointerleave="cancelSessionPrefetch"
              @focus="
                void store.appState?.prefetchSession(row.session.id).catch(() => undefined)
              "
              @mouseenter="onSessionRowEnter($event, row.session, row.model.temporary)"
              @mouseleave="scheduleSessionHoverCardHide"
              @focusin="onSessionRowFocusIn($event, row.session, row.model.temporary)"
              @blur="scheduleSessionHoverCardHide"
              @click="onSessionMainClick(row)"
            >
              <IconPin
                v-if="row.model.pinned"
                :size="11"
                class="thread-item-pin"
                aria-hidden="true"
              />
              <span
                v-if="row.session.source === 'pi-native'"
                class="thread-item-source"
                title="Native Pi session"
              >
                Pi
              </span>
              <span class="thread-item-title">{{ row.model.title }}</span>
              <span v-if="row.model.global" class="thread-item-project">
                {{ row.model.owningProject }}
              </span>
            </button>
            <div class="sidebar-row-actions">
              <TooltipButton
                as="button"
                class="thread-item-more"
                data-action="session-menu"
                :label="tt('nav.sessionActions', 'Session actions')"
                :aria-label="tt('nav.sessionActions', 'Session actions')"
                aria-haspopup="menu"
                :aria-expanded="sessionMenu === row.session.id"
                @click="onSessionMenuClick($event, row.session.id)"
              >
                <IconMore :size="14" />
              </TooltipButton>
            </div>
          </div>
        </div>
      </section>

      <section
        class="sidebar-standalone-sessions"
        aria-labelledby="sidebar-standalone-sessions-label"
        data-sidebar-session-section="temporary"
      >
        <div
          class="sidebar-list-toolbar sidebar-list-toolbar-secondary"
          data-sidebar-section="sessions"
          @contextmenu="onSectionToolbarContextMenu($event, 'sessions')"
          @pointerdown="onSectionToolbarPointerDown"
        >
          <span id="sidebar-standalone-sessions-label" class="sidebar-list-label">
            {{ tt("nav.sessions", "Sessions") }}
          </span>
          <div class="sidebar-toolbar-actions">
            <div class="sidebar-menu-wrap">
              <TooltipButton
                as="button"
                class="sidebar-toolbar-button"
                :class="{ active: sortOpen }"
                data-action="session-sort"
                :label="tt('nav.sortSessions', 'Sort sessions')"
                :aria-label="tt('nav.sortSessions', 'Sort sessions')"
                aria-haspopup="menu"
                :aria-expanded="sortOpen"
                @click="onSortMenuClick"
              >
                <IconArrowUpDown :size="14" />
              </TooltipButton>
            </div>
            <TooltipButton
              as="button"
              class="sidebar-toolbar-button"
              data-action="new-standalone-session"
              :label="t('nav.newTemporarySession')"
              :aria-label="t('nav.newTemporarySession')"
              @click="void createSession({ projectPath: null })"
            >
              <IconNewSession :size="14" />
            </TooltipButton>
          </div>
        </div>
        <div
          class="sidebar-session-group-body standalone"
          @scroll="onStandaloneScroll"
          @contextmenu="onStandaloneContextMenu"
        >
          <template v-if="temporaryRows.length > 0">
            <div
              v-for="row in temporaryRows"
              :key="row.session.id"
              class="thread-item"
              :class="{
                active: row.model.active,
                archived: row.model.archived,
                'is-dragging': draggingSessionId === row.session.id,
              }"
              :data-sidebar-session-row="row.session.id"
              :draggable="!row.model.running"
              @dragstart="onSessionDragStart($event, row.session.id, row.model.running)"
              @dragend="endSessionDrag"
              @click="onSessionRowClick($event, row)"
              @contextmenu="onSessionRowContextMenu($event, row.session.id)"
            >
              <span
                v-if="row.model.status"
                class="thread-item-status"
                :class="row.model.status"
                :aria-label="sessionStatusLabel(row.model.status)"
                :title="sessionStatusLabel(row.model.status)"
              >
                <IconCheck
                  v-if="row.model.status === 'completed'"
                  :size="10"
                  aria-hidden="true"
                />
                <IconCircleAlert
                  v-if="row.model.status === 'failed'"
                  :size="11"
                  aria-hidden="true"
                />
              </span>
              <button
                type="button"
                class="thread-item-main"
                :aria-current="row.model.active ? 'page' : undefined"
                :aria-describedby="
                  sessionHoverCard?.session.id === row.session.id
                    ? `session-hover-${row.session.id}`
                    : undefined
                "
                @pointerenter="scheduleSessionPrefetch(row.session.id)"
                @pointerleave="cancelSessionPrefetch"
                @focus="
                  void store.appState?.prefetchSession(row.session.id).catch(() => undefined)
                "
                @mouseenter="onSessionRowEnter($event, row.session, row.model.temporary)"
                @mouseleave="scheduleSessionHoverCardHide"
                @focusin="onSessionRowFocusIn($event, row.session, row.model.temporary)"
                @blur="scheduleSessionHoverCardHide"
                @click="onSessionMainClick(row)"
              >
                <IconPin
                  v-if="row.model.pinned"
                  :size="11"
                  class="thread-item-pin"
                  aria-hidden="true"
                />
                <span
                  v-if="row.session.source === 'pi-native'"
                  class="thread-item-source"
                  title="Native Pi session"
                >
                  Pi
                </span>
                <span class="thread-item-title">{{ row.model.title }}</span>
              </button>
              <div class="sidebar-row-actions">
                <TooltipButton
                  as="button"
                  class="thread-item-more"
                  data-action="session-menu"
                  :label="tt('nav.sessionActions', 'Session actions')"
                  :aria-label="tt('nav.sessionActions', 'Session actions')"
                  aria-haspopup="menu"
                  :aria-expanded="sessionMenu === row.session.id"
                  @click="onSessionMenuClick($event, row.session.id)"
                >
                  <IconMore :size="14" />
                </TooltipButton>
              </div>
            </div>
          </template>
          <div v-else-if="temporarySessions.length === 0" class="sidebar-session-empty">
            {{ t("nav.noTemporarySessions") }}
          </div>
        </div>
      </section>

      <div
        class="sidebar-list-toolbar"
        data-sidebar-section="projects"
        @contextmenu="onSectionToolbarContextMenu($event, 'projects')"
        @pointerdown="onSectionToolbarPointerDown"
      >
        <span class="sidebar-list-label">{{ t("nav.projects") }}</span>
        <TooltipButton
          as="button"
          class="sidebar-toolbar-button"
          data-action="new-project"
          :label="t('nav.newProject')"
          :aria-label="t('nav.newProject')"
          @click="void openProjectPicker()"
        >
          <IconNewProject :size="14" />
        </TooltipButton>
      </div>

      <div
        class="sidebar-session-groups min-h-0 flex-1 overflow-auto px-0.5"
        :class="{ 'is-drop-target': projectsDropActive }"
        @scroll="onStandaloneScroll"
        @contextmenu="onProjectsContextMenu"
        @dragenter="onProjectsAreaDragEnter"
        @dragover="onProjectsAreaDragOver"
        @dragleave="onProjectsAreaDragLeave"
        @drop="onProjectsAreaDrop"
      >
        <template v-if="projectGroups.length > 0">
          <section
            v-for="group in projectGroups"
            :key="group.entry.key"
            class="sidebar-session-group project-group"
            :class="{
              archived: group.entry.meta.archived,
              'is-drop-target': dropProjectKey === group.entry.key,
              'is-dragging': draggingProjectKey === group.entry.key,
              'is-drop-after':
                dropIndicator?.key === group.entry.key && dropIndicator.insertAfter,
              'is-drop-before':
                dropIndicator?.key === group.entry.key && !dropIndicator.insertAfter,
            }"
            :aria-labelledby="group.projectId"
            :data-sidebar-project-group="group.entry.key"
            :data-current-workspace="group.entry.active ? 'true' : undefined"
            @dragover="onProjectDropTargetOver($event, group.entry)"
            @dragleave="onProjectGroupDragLeave($event, group.entry)"
            @drop="onProjectDropTargetDrop($event, group.entry)"
          >
            <div
              class="sidebar-session-group-header"
              @click="onProjectHeaderClick($event, group)"
              @contextmenu="onProjectHeaderContextMenu($event, group.entry)"
            >
              <TooltipButton
                as="button"
                :id="group.projectId"
                class="sidebar-session-group-title project-toggle"
                :label="group.entry.path"
                :delay-ms="500"
                tooltip-class-name="ui-tooltip-path"
                :aria-label="group.entry.name"
                :aria-describedby="`${group.projectId}-path-description`"
                :aria-expanded="!group.collapsedProject"
                :aria-controls="`${group.projectId}-sessions`"
                aria-keyshortcuts="ArrowUp ArrowDown"
                :aria-grabbed="draggingProjectKey === group.entry.key"
                data-action="toggle-project-collapse"
                @dragstart="onProjectTitleDragStart"
                @pointerdown="beginProjectReorderPress($event, group.entry.key)"
                @keydown="moveProjectWithKeyboard($event, group.entry.key)"
                @click="onProjectTitleClick(group)"
              >
                <IconChevronDown
                  :size="13"
                  class="sidebar-disclosure-icon"
                  :class="{ collapsed: group.collapsedProject }"
                />
                <IconStar
                  v-if="group.entry.meta.pinned"
                  :size="13"
                  fill="currentColor"
                  class="sidebar-project-pin"
                  aria-hidden="true"
                />
                <IconFolder v-else :size="13" aria-hidden="true" />
                <span>{{ group.entry.name }}</span>
                <span
                  v-if="group.entry.active"
                  class="sidebar-project-active-dot"
                  :aria-label="tt('project.active', 'Active')"
                />
              </TooltipButton>
              <span :id="`${group.projectId}-path-description`" class="sr-only">
                {{ group.entry.path }}{{ ". " }}{{
                  t("project.reorder", { name: group.entry.name })
                }}
              </span>
              <div class="sidebar-menu-wrap">
                <TooltipButton
                  as="button"
                  class="thread-item-more project-more"
                  :label="t('project.openActions', { name: group.entry.name })"
                  :aria-label="t('project.openActions', { name: group.entry.name })"
                  aria-haspopup="menu"
                  :aria-expanded="group.isMenuOpen"
                  @click="onProjectMenuClick($event, group)"
                >
                  <IconMore :size="14" />
                </TooltipButton>
              </div>
              <TooltipButton
                as="button"
                class="sidebar-session-group-add"
                :label="
                  group.entry.active
                    ? t('project.newTask')
                    : tt('project.openAndNewTask', 'Open project and create task')
                "
                :aria-label="
                  group.entry.active
                    ? t('project.newTask')
                    : tt('project.openAndNewTask', 'Open project and create task')
                "
                @click="void createProjectSession(group.entry.path)"
              >
                <IconNewSession :size="13" />
              </TooltipButton>
            </div>
            <div
              :id="`${group.projectId}-sessions`"
              class="sidebar-session-group-body project"
              :class="{ collapsed: group.collapsedProject }"
              role="region"
              :aria-hidden="group.collapsedProject"
              :inert="group.collapsedProject ? true : undefined"
            >
              <div class="sidebar-session-group-clip">
                <div class="sidebar-session-group-list">
                  <template v-if="group.entry.sessions.length > 0">
                    <template
                      v-for="timeGroup in group.timeGroups"
                      :key="timeGroup.group"
                    >
                      <!-- For today, don't show a header (as per requirement). -->
                      <div
                        v-if="timeGroup.group !== 'today'"
                        class="sidebar-time-group-header"
                      >
                        {{ t(timeGroup.headerKey) }}
                      </div>
                      <div
                        v-for="row in timeGroup.rows"
                        :key="row.session.id"
                        class="thread-item"
                        :class="{
                          active: row.model.active,
                          archived: row.model.archived,
                          'is-dragging': draggingSessionId === row.session.id,
                        }"
                        :data-sidebar-session-row="row.session.id"
                        :draggable="!row.model.running"
                        @dragstart="
                          onSessionDragStart($event, row.session.id, row.model.running)
                        "
                        @dragend="endSessionDrag"
                        @click="onSessionRowClick($event, row)"
                        @contextmenu="onSessionRowContextMenu($event, row.session.id)"
                      >
                        <span
                          v-if="row.model.status"
                          class="thread-item-status"
                          :class="row.model.status"
                          :aria-label="sessionStatusLabel(row.model.status)"
                          :title="sessionStatusLabel(row.model.status)"
                        >
                          <IconCheck
                            v-if="row.model.status === 'completed'"
                            :size="10"
                            aria-hidden="true"
                          />
                          <IconCircleAlert
                            v-if="row.model.status === 'failed'"
                            :size="11"
                            aria-hidden="true"
                          />
                        </span>
                        <button
                          type="button"
                          class="thread-item-main"
                          :aria-current="row.model.active ? 'page' : undefined"
                          :aria-describedby="
                            sessionHoverCard?.session.id === row.session.id
                              ? `session-hover-${row.session.id}`
                              : undefined
                          "
                          @pointerenter="scheduleSessionPrefetch(row.session.id)"
                          @pointerleave="cancelSessionPrefetch"
                          @focus="
                            void store.appState
                              ?.prefetchSession(row.session.id)
                              .catch(() => undefined)
                          "
                          @mouseenter="
                            onSessionRowEnter($event, row.session, row.model.temporary)
                          "
                          @mouseleave="scheduleSessionHoverCardHide"
                          @focusin="
                            onSessionRowFocusIn($event, row.session, row.model.temporary)
                          "
                          @blur="scheduleSessionHoverCardHide"
                          @click="onSessionMainClick(row)"
                        >
                          <IconPin
                            v-if="row.model.pinned"
                            :size="11"
                            class="thread-item-pin"
                            aria-hidden="true"
                          />
                          <span
                            v-if="row.session.source === 'pi-native'"
                            class="thread-item-source"
                            title="Native Pi session"
                          >
                            Pi
                          </span>
                          <span class="thread-item-title">{{ row.model.title }}</span>
                        </button>
                        <div class="sidebar-row-actions">
                          <TooltipButton
                            as="button"
                            class="thread-item-more"
                            data-action="session-menu"
                            :label="tt('nav.sessionActions', 'Session actions')"
                            :aria-label="tt('nav.sessionActions', 'Session actions')"
                            aria-haspopup="menu"
                            :aria-expanded="sessionMenu === row.session.id"
                            @click="onSessionMenuClick($event, row.session.id)"
                          >
                            <IconMore :size="14" />
                          </TooltipButton>
                        </div>
                      </div>
                    </template>
                    <button
                      v-if="group.hiddenCount > 0"
                      type="button"
                      class="sidebar-load-more"
                      @click="expandProjectSessions(group.entry.key)"
                    >
                      {{ t("nav.loadMoreCount", { count: group.hiddenCount }) }}
                    </button>
                  </template>
                  <div v-else class="sidebar-session-empty">
                    {{ t("nav.noProjectSessions") }}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </template>
        <section
          v-else
          class="sidebar-session-group"
          aria-labelledby="sidebar-project-group-label"
        >
          <div class="sidebar-session-group-header">
            <button
              type="button"
              id="sidebar-project-group-label"
              class="sidebar-session-group-title"
              @click="void openProjectPicker()"
            >
              <IconFolder :size="13" />
              <span>{{ t("project.open") }}</span>
            </button>
          </div>
        </section>
      </div>

      <div class="sidebar-footer no-drag">
        <div class="footer-actions">
          <TooltipButton
            as="button"
            class="footer-action"
            :class="{ active: page === 'settings' }"
            data-nav="settings"
            :label="t('nav.settings')"
            :aria-label="t('nav.settings')"
            :aria-pressed="page === 'settings'"
            @click="store.appState?.setPage('settings')"
          >
            <IconSettings :size="14" aria-hidden="true" />
          </TooltipButton>
          <TooltipButton
            as="button"
            class="footer-action"
            :class="{ active: page === 'plugins' }"
            data-nav="plugins"
            :label="t('nav.plugins')"
            :aria-label="t('nav.plugins')"
            :aria-pressed="page === 'plugins'"
            @click="onPluginsClick"
          >
            <IconPlug :size="14" aria-hidden="true" />
          </TooltipButton>
          <NotificationCenter :on-before-open="() => closeMenus(false)" />
        </div>

        <TooltipButton
          as="button"
          class="footer-build"
          :class="{ 'has-update': updateReady }"
          data-nav="build"
          :label="buildTitle"
          :aria-label="buildTitle"
          @click="onBuildClick"
        >
          <span class="footer-build-version">{{ buildLabel }}</span>
          <span v-if="updateReady" class="footer-build-dot" aria-hidden="true" />
        </TooltipButton>
      </div>
    </div>

    <Teleport v-if="floatingMenuVisible" to="body">
      <div
        v-if="sectionMenu"
        class="sidebar-row-menu sidebar-floating-menu sidebar-section-menu"
        role="menu"
        :data-sidebar-section-menu="sectionMenu"
        :style="menuStyle"
        @keydown="onMenuKeyDown"
      >
        <button
          ref="menuFirstItemRef"
          type="button"
          role="menuitem"
          :data-action="sectionMenu === 'sessions' ? 'new-standalone-session' : 'new-project'"
          @click="runSectionMenuAction"
        >
          <IconNewSession v-if="sectionMenu === 'sessions'" :size="14" />
          <IconNewProject v-else :size="14" />
          <span>
            {{
              sectionMenu === "sessions"
                ? t("nav.newTemporarySession")
                : t("nav.newProject")
            }}
          </span>
        </button>
      </div>

      <div
        v-else-if="sortOpen"
        class="sidebar-popover sidebar-sort-menu sidebar-floating-menu"
        role="menu"
        :style="menuStyle"
        @keydown="onMenuKeyDown"
      >
        <div class="sidebar-popover-title">
          {{ tt("nav.sortSessions", "Sort sessions") }}
        </div>
        <button
          v-for="(value, index) in SESSION_SORT_OPTIONS"
          :key="value"
          :ref="index === 0 ? setFirstMenuItem : undefined"
          type="button"
          role="menuitemradio"
          :aria-checked="displaySessionSort === value"
          :class="{ selected: displaySessionSort === value }"
          :data-sort="value"
          @click="setSort(value)"
        >
          <span>{{ sortOptionLabel(value) }}</span>
          <span v-if="displaySessionSort === value" class="sidebar-sort-check">✓</span>
        </button>
        <div class="sidebar-popover-divider" />
        <button
          type="button"
          role="menuitemcheckbox"
          :aria-checked="showArchived"
          data-action="toggle-show-archived"
          @click="toggleShowArchived"
        >
          <span>
            {{
              showArchived
                ? tt("nav.hideArchived", "Hide archived")
                : tt("nav.showArchived", "Show archived")
            }}
          </span>
          <span class="sidebar-checkbox" :class="{ checked: showArchived }">
            {{ showArchived ? "✓" : "" }}
          </span>
        </button>
      </div>

      <div
        v-else-if="menuSession || menuProjectEntry"
        class="sidebar-row-menu sidebar-floating-menu"
        role="menu"
        :style="menuStyle"
        @keydown="onMenuKeyDown"
      >
        <template v-if="menuSession">
          <button
            v-if="menuSession.source !== 'pi-native'"
            ref="menuFirstItemRef"
            type="button"
            role="menuitem"
            data-action="rename-session"
            @click="openRenameDialog"
          >
            <IconPencil :size="14" />
            {{ tt("nav.renameTask", "Rename task") }}
          </button>
          <button
            type="button"
            role="menuitem"
            data-action="toggle-session-pin"
            @click="toggleSessionPin(menuSession)"
          >
            <IconPin :size="14" />
            {{
              sessionPinned(menuSession, sessionMeta[menuSession.id])
                ? tt("nav.unpinTask", "Unpin")
                : tt("nav.pinTask", "Pin")
            }}
          </button>
          <button
            type="button"
            role="menuitem"
            data-action="toggle-session-archive"
            @click="void archiveSession(menuSession)"
          >
            <IconArchiveRestore
              v-if="sessionArchived(menuSession, sessionMeta[menuSession.id])"
              :size="14"
            />
            <IconArchive v-else :size="14" />
            {{
              sessionArchived(menuSession, sessionMeta[menuSession.id])
                ? tt("nav.restoreTask", "Restore")
                : tt("nav.archiveTask", "Archive")
            }}
          </button>
          <button
            v-if="menuSession.source !== 'pi-native'"
            type="button"
            role="menuitem"
            data-action="fork-session"
            :disabled="Boolean(runningSessions[menuSession.id])"
            @click="void forkSession(menuSession)"
          >
            <IconBranch :size="14" />
            {{ t("nav.createBranch") }}
          </button>
          <template v-if="settings?.developerMode === true">
            <button
              type="button"
              role="menuitem"
              data-action="copy-conversation-id"
              @click="void copyConversationId(menuSession)"
            >
              <IconCopy :size="14" />
              {{ t("nav.copyConversationId") }}
            </button>
            <button
              type="button"
              role="menuitem"
              data-action="open-session-path"
              @click="void openSessionPath(menuSession)"
            >
              <IconFolder :size="14" />
              {{ t("nav.openSessionPath") }}
            </button>
          </template>
          <button
            v-if="menuSession.source !== 'pi-native'"
            type="button"
            role="menuitem"
            :class="cx('danger', armedDelete === menuSession.id && 'is-armed')"
            data-action="delete-session"
            :data-armed="armedDelete === menuSession.id ? 'true' : undefined"
            @click="requestDeleteSession(menuSession)"
          >
            <IconX :size="14" />
            {{
              armedDelete === menuSession.id
                ? tt("nav.deleteTaskConfirm", "Delete?")
                : tt("nav.deleteTask", "Delete")
            }}
          </button>
        </template>

        <template v-if="menuProjectEntry">
          <button
            ref="menuFirstItemRef"
            type="button"
            role="menuitem"
            data-action="open-project-folder"
            @click="void openProjectFolder(menuProjectEntry)"
          >
            <IconFolder :size="14" />
            {{ tt("project.openFolder", "Open folder") }}
          </button>
          <button
            type="button"
            role="menuitem"
            data-action="edit-project"
            @click="openEditProjectDialog"
          >
            <IconPencil :size="14" />
            {{ tt("project.edit", "Edit project") }}
          </button>
          <button
            type="button"
            role="menuitem"
            data-action="toggle-project-pin"
            @click="toggleProjectPin(menuProjectEntry)"
          >
            <IconPin :size="14" />
            {{
              menuProjectEntry.meta.pinned ? t("project.unpin") : t("project.pin")
            }}
          </button>
          <button
            type="button"
            role="menuitem"
            data-action="toggle-project-archive"
            @click="void archiveProject(menuProjectEntry)"
          >
            <IconArchiveRestore v-if="menuProjectEntry.meta.archived" :size="14" />
            <IconArchive v-else :size="14" />
            {{
              menuProjectEntry.meta.archived
                ? tt("project.restore", "Restore project")
                : tt("project.archive", "Archive project")
            }}
          </button>
          <button
            type="button"
            role="menuitem"
            :class="cx('danger', armedDelete === projectDeleteKey(menuProjectEntry) && 'is-armed')"
            data-action="delete-project"
            :data-armed="
              armedDelete === projectDeleteKey(menuProjectEntry) ? 'true' : undefined
            "
            @click="void requestDeleteProject(menuProjectEntry)"
          >
            <IconTrash :size="14" />
            {{
              armedDelete === projectDeleteKey(menuProjectEntry)
                ? tt("project.deleteMenuConfirm", "Delete?")
                : tt("project.delete", "Delete project")
            }}
          </button>
          <button
            v-if="menuProjectEntry.open"
            type="button"
            role="menuitem"
            @click="void closeProject(menuProjectEntry)"
          >
            <IconX :size="14" />
            {{ t("project.close") }}
          </button>
        </template>
      </div>
    </Teleport>

    <SessionHoverCard
      v-if="sessionHoverCard"
      :key="sessionHoverCard.session.id"
      :card="sessionHoverCard"
      :refresh-project="refreshProjectAction"
      @open-session="openSessionFromHover"
      @keep-visible="keepSessionHoverCardVisible"
      @schedule-hide="scheduleSessionHoverCardHide"
    />

    <SessionRenameDialog
      v-if="renameFor"
      :key="renameFor.id"
      :session="renameFor"
      @close="renameFor = null"
      @saved="onRenameSave"
      @error="reportError"
    />

    <ProjectEditDialog
      v-if="editProjectTarget"
      :key="editProjectTarget.path"
      :project="editProjectTarget"
      @close="editProjectFor = null"
      @saved="onProjectSaved"
      @error="reportError"
    />

    <ProjectDeleteDialog
      v-if="deleteProjectTarget"
      :key="deleteProjectTarget.path"
      :project="deleteProjectTarget"
      :running-session-ids="deleteProjectRunningIds"
      @close="deleteProjectFor = null"
      @deleted="onProjectDeleted"
      @error="reportError"
    />

    <div
      class="sidebar-resize-handle no-drag"
      :class="{ 'is-resizing': sidebarResizing }"
      role="separator"
      aria-orientation="vertical"
      :aria-label="t('nav.resizeSidebar')"
      :aria-valuemin="SIDEBAR_WIDTH_MIN"
      :aria-valuemax="clampSidebarWidth(widthMax, widthMax)"
      :aria-valuenow="clampSidebarWidth(sidebarWidth, widthMax)"
      :aria-valuetext="t('nav.sidebarWidth', { width: clampSidebarWidth(sidebarWidth, widthMax) })"
      tabindex="0"
      @pointerdown="startSidebarResize"
      @pointermove="moveSidebarResize"
      @pointerup="endSidebarResize"
      @pointercancel="cancelSidebarResize"
      @lostpointercapture="cancelSidebarResize"
      @keydown="handleSidebarResizeKeyDown"
      @dblclick="resetSidebarWidth"
    />
  </aside>
</template>
