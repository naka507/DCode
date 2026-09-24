/**
 * The composed renderer store — a Pinia setup store.
 *
 * A Pinia setup store. Two properties are load-bearing:
 *
 *   1. The `{ get, set }` shape and the skip-a-commit contract (`set` treats an
 *      updater that returns the current state object as "no change") are kept,
 *      because the 18 slices and runtimes below depend on both. The state cell
 *      is created by the Pinia store, so a component read is tracked and
 *      devtools can see the tree.
 *
 *      The payload is held in a `shallowRef`, never `ref` / `reactive`. A deep
 *      proxy would make every state object unreachable to `structuredClone`,
 *      which is what Electron's IPC serializer uses, so any `api.*` call that
 *      hands a state-derived object across the bridge would throw "could not be
 *      cloned". A shallow ref keeps the flat object raw while still notifying
 *      `watch` / `computed` when a commit replaces it, and keeps the
 *      reference-identity comparisons the reconciliation runtimes rely on
 *      (`state.messages === previous.messages`) exact.
 *   2. Translation goes through the vue-i18n instance in `../i18n`
 *      (`i18n.global.t`).
 *
 * Helper functions, merge order, cache boundaries, error handling, the boot
 * sequence and the subscription that reconciles reading views with the
 * canonical caches are otherwise unchanged.
 */
import { defineStore } from "pinia";
import { shallowRef } from "vue";
import { i18n } from "../i18n";
import { rendererPinia } from "./pinia";
import type {
  AgentEventEnvelope,
  AgentStatus,
  AgentPromptAttachment,
  AskToolResolution,
  AppError,
  AppNotification,
  AppSettings,
  AppVersionInfo,
  ContextCompactionMark,
  ContextCompactionRecord,
  ModelInfo,
  OnboardingState,
  Mode,
  PlanProposal,
  PlanResolveRequest,
  PlanResolutionResult,
  PlanningState,
  PlanningStateEvent,
  PluginSummary,
  PluginTheme,
  PluginViewMeta,
  PermissionMode,
  ProjectWorkspace,
  ProposalKind,
  ProviderPublic,
  ReviewRollbackResult,
  SessionDetail,
  SessionSummary,
  ThinkingLevel,
  UiMessage,
} from "@dcode/shared";
import {
  contextCompactionMark,
  ErrorCodes as SharedErrorCodes,
  initialThinkingLevelForBinding,
  modeForProposalKind,
  migrateKeybindingOverrides,
  modelIdsMatch,
  normalizeMode,
  normalizeProposalKind,
  PROTOCOL_VERSION,
} from "@dcode/shared";
import { api } from "../lib/api";
import type { SettingsTabId } from "../lib/settings-search";
import { createNavigationIntentController } from "../lib/navigation-intent";
import { scheduleHomeDraftAdopt } from "../lib/composer-draft-cache";
import {
  commitForkedSessionState,
  forkedSessionMessages,
  FORKED_SESSION_WINDOW,
} from "../lib/session-fork";
import {
  EMPTY_SESSION_WINDOW,
  sessionIsReusableEmpty,
} from "../lib/session-create";
import {
  rememberProject,
  renameRecentProject,
  setProjectPinned,
} from "../lib/recent-projects";
import { applyOptimisticSessionConfiguration } from "../lib/session-thinking";
import {
  RETAINED_SESSION_PANE_LIMIT,
  clearSessionPanes,
  releaseSessionPane,
  retainSessionPane,
} from "../lib/session-panes";
import { normalizeProjectPath, sessionMatchesProject } from "../lib/sidebar-session-groups";
import {
  dedupeSessionMessages,
  mergeLiveSessionMessages,
  removeLiveSessionMessage,
  optimisticUserMessage,
  upsertLiveSessionMessage,
  durableCoversLiveSessionMessages,
} from "../lib/session-transcript";
import {
  latestSessionOutcomes,
  type SidebarSessionOutcome,
} from "../lib/sidebar-session-status";
import {
  loadSidebarPreferences,
  projectIsArchived,
  projectIsCollapsed,
  projectIsPinned,
  projectWorkspaceFromPath,
  saveSidebarPreferences,
  sessionIsArchived,
  sessionIsPinned,
  sortProjects,
  sortSessions,
  normalizeProjectName,
  type ProjectMeta,
  type ProjectSort,
  type SessionMeta,
  type SessionSort,
} from "../lib/sidebar-preferences";
import { settleStoppedAssistantMetrics } from "../lib/context-usage";
import { formatToolValue } from "../lib/tool-display";
import { withReviewChangeState } from "../lib/workspace-review";
import { preferredFileWorkPanelTab } from "../lib/work-panel-tabs";
import {
  clearSessionPermissions,
  enqueuePermission,
  headPermission,
  removePermission,
  removePermissionForToolCall,
  sessionPermissions,
  type PermissionQueues,
} from "../lib/pending-permissions";
import {
  clearSessionAsks,
  enqueueAsk,
  headAsk,
  removeAsk,
  removeAskForToolCall,
  type AskQueues,
} from "../lib/pending-asks";
import {
  WORK_PANEL_DEFAULT_WIDTH,
  WORK_PANEL_MIN_WIDTH,
} from "../lib/work-panel-resize";
import {
  isActivePlanExecution,
  isPendingPlan,
  latestPlanProposal,
  mergePlanCheckpoint,
  terminalizeMissingPlan,
} from "../lib/plan-mode-state";
import {
  resolveComposerSmartStop,
  type ComposerDraftSnapshot,
  type ComposerPrefill,
} from "../lib/composer-smart-stop";
import {
  enqueueQueuedPrompt,
  promoteQueuedPrompt,
  queuedPromptForSession,
  removeQueuedPrompt,
  type QueuedPrompt,
  type QueuedPrompts,
} from "../lib/queued-prompts";
import type { AgentQueueChangedEvent, QueuedTurnSummary } from "@dcode/shared";
import { settleBootstrapRequests } from "../lib/bootstrap-result";
import type { SubagentPanelSelection } from "../lib/subagent-panel";
import {
  createSessionRuntime,
  type SessionRuntime,
  type SubmittedComposerDraft,
} from "./runtime/session-runtime";
import type { StoreAccess } from "./slices/types";
import {
  createWorkPanelSlice,
  currentWorkPanelContext,
  switchWorkPanelSession,
} from "./slices/work-panel-slice";
import {
  createInitialState,
  initialSidebarPreferences,
} from "./slices/initial-state";
import type {
  AgentTurnResult,
  DraftSessionConfiguration,
  PendingPlanRefreshResult,
  ToastItem,
  ToastOptions,
  ToastVariant,
} from "./app-state";
import { createSessionSlice } from "./slices/session-slice";
import { createQueueSlice } from "./slices/queue-slice";
import { createTranscriptSlice } from "./slices/transcript-slice";
import { createProjectSlice } from "./slices/project-slice";
import { createCatalogSlice } from "./slices/catalog-slice";
import { createEventsSlice } from "./slices/events-slice";
import { createInteractionSlice } from "./slices/interaction-slice";
import {
  createCatalogRuntime,
  type CatalogRuntime,
} from "./runtime/catalog-runtime";
import {
  createSessionCoordination,
  type SessionCoordination,
} from "./runtime/session-coordination";
import {
  createInteractionRuntime,
  type InteractionRuntime,
} from "./runtime/interaction-runtime";
import {
  createSessionTitleRuntime,
  isDefaultSessionTitle,
  promptFallbackSessionTitle,
  untitledTaskTitle,
} from "./runtime/session-title-runtime";
import { createInteractivePromptNotifier } from "./runtime/notification-runtime";
import { createTranscriptReadingRuntime } from "./runtime/transcript-reading-runtime";
export type {
  AgentTurnResult,
  DraftSessionConfiguration,
  PendingPlanRefreshResult,
  ToastItem,
  ToastOptions,
  ToastVariant,
} from "./app-state";
export { isDefaultSessionTitle } from "./runtime/session-title-runtime";

export type { WorkPanelTab } from "../lib/work-panel-tabs";

function promptAttachmentsFromDraft(
  references: ComposerDraftSnapshot["fileReferences"],
): AgentPromptAttachment[] {
  return references.flatMap((reference) => {
    const kind =
      reference.kind ??
      (/\.(avif|bmp|gif|heic|jpe?g|png|tiff?|webp)$/i.test(reference.path)
        ? "image"
        : "file");
    // Inline chips use tokens for both files and images. Ordinary file chips
    // already serialize to @path text (the model can Read them); only image
    // chips need the structured transport for vision/fallback handling.
    if (reference.token && kind !== "image") return [];
    return [
      {
        path: reference.path,
        name: reference.name,
        kind,
        ...(reference.mimeType ? { mimeType: reference.mimeType } : {}),
      },
    ];
  });
}

function promptAttachmentsFromMessage(
  attachments: UiMessage["attachments"],
): AgentPromptAttachment[] {
  return (attachments ?? []).map((attachment) => ({
    path: attachment.ref,
    name: attachment.name,
    kind: attachment.kind,
    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    ...(attachment.size !== undefined ? { size: attachment.size } : {}),
  }));
}

// Sessions created before locale switches keep their old default title, so
// match against every locale's defaults (case-insensitive), not just the
// active locale's.
function withoutRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function viewingSessionIdForPrompt(
  state: Pick<AppState, "page" | "activeSessionId">,
  sessionId: string,
): string | null {
  return state.page === "chat" && state.activeSessionId === sessionId
    ? sessionId
    : null;
}

export const SESSION_TRANSCRIPT_PAGE_SIZE = 100;
export const SESSION_TRANSCRIPT_CONTENT_LIMIT = 64 * 1024;
export { RETAINED_SESSION_PANE_LIMIT };
// Preserve the 320px tool-content minimum beside the 44px activity rail.
export { WORK_PANEL_DEFAULT_WIDTH, WORK_PANEL_MIN_WIDTH };

function messageErrorFromUnknown(error: unknown): AppError {
  const value = error as {
    code?: string;
    message?: string;
    retriable?: boolean;
  };
  return {
    code: value?.code || "INTERNAL",
    message:
      error instanceof Error
        ? error.message
        : typeof value?.message === "string"
          ? value.message
          : String(error),
    retriable: value?.retriable === true,
  };
}

function assistantErrorMessage(error: AppError): UiMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    status: "error",
    isError: true,
    error,
  };
}

/** Project planning state and proposal kind determine the durable mode shown in the sidebar. */
function sessionModeForPlanningState(
  state: PlanningState,
  kind: ProposalKind | undefined,
): Mode {
  if (state === "inactive") return "agent";
  return modeForProposalKind(kind ?? "plan");
}

export type AppState = import("./app-state").AppState;

function openPlanArtifact(
  proposal: PlanProposal,
  openWorkPanelTabForSession: AppState["openWorkPanelTabForSession"],
  pluginViews: AppState["pluginViews"],
) {
  const relativePath = proposal.artifact?.relativePath;
  if (!relativePath) return;
  openWorkPanelTabForSession(
    proposal.sessionId,
    preferredFileWorkPanelTab(relativePath, pluginViews),
  );
}

function decorateSessions(
  sessions: SessionSummary[],
  meta: Record<string, SessionMeta>,
): SessionSummary[] {
  return sessions.map((session) => ({
    ...session,
    pinned: sessionIsPinned(session.id, meta),
    archived: sessionIsArchived(session.id, meta),
  }));
}

function promoteProjectPath(paths: string[], rawPath: string): string[] {
  const key = normalizeProjectPath(rawPath);
  if (!key) return paths;
  const withoutPath = paths.filter(
    (path) => normalizeProjectPath(path) !== key,
  );
  return [...withoutPath, rawPath];
}

function removeProjectPath(paths: string[], rawPath: string): string[] {
  const key = normalizeProjectPath(rawPath);
  return key
    ? paths.filter((path) => normalizeProjectPath(path) !== key)
    : paths;
}

function upsertWorkspace(
  projects: ProjectWorkspace[],
  workspace: ProjectWorkspace,
): ProjectWorkspace[] {
  const key = normalizeProjectPath(workspace.path);
  if (!key) return projects;
  const index = projects.findIndex((item) => normalizeProjectPath(item.path) === key);
  if (index < 0) return [...projects, workspace];
  const next = projects.slice();
  next[index] = { ...next[index], ...workspace };
  return next;
}

function withProjectDisplayName(
  workspace: ProjectWorkspace,
  projectMeta: Record<string, ProjectMeta>,
): ProjectWorkspace {
  const key = normalizeProjectPath(workspace.path);
  const name = key ? projectMeta[key]?.name : undefined;
  return name ? { ...workspace, name } : workspace;
}

function preferencesFromState(state: Pick<
  AppState,
  | "sessionMeta"
  | "projectMeta"
  | "projectSort"
  | "sessionView"
  | "openProjectPaths"
>) {
  return {
    sessionMeta: state.sessionMeta,
    projectMeta: state.projectMeta,
    projectSort: state.projectSort,
    sessionView: state.sessionView,
    openProjectPaths: state.openProjectPaths,
  };
}

function persistCurrentSidebar(getState: () => AppState): void {
  saveSidebarPreferences(preferencesFromState(getState()));
}

/** Append a freshly installed checkpoint, or replace a retried one by id. */
function withCompactionMark(
  marks: ContextCompactionMark[] | undefined,
  mark: ContextCompactionMark,
): ContextCompactionMark[] {
  return [...(marks ?? []).filter((existing) => existing.id !== mark.id), mark];
}

/**
 * The composed state container — the renderer's single Pinia store.
 *
 * `appState` is a `shallowRef`, never `ref` / `reactive`. A deep proxy would
 * make every state object unreachable to `structuredClone`, which is what
 * Electron's IPC serializer uses, so any `api.*` call handing a state-derived
 * object across the bridge would throw "could not be cloned". A shallow ref
 * keeps the flat object raw while still notifying `watch` / `computed` when a
 * commit replaces it, and keeps the reference-identity comparisons the
 * reconciliation runtimes rely on (`state.messages === previous.messages`)
 * exact.
 *
 * Components read the store through `store.appState` (or `storeToRefs`), which
 * tracks the ref. `getState()` is deliberately *not* part of the returned
 * surface: a plain method call is not tracked, so exposing it would invite
 * `useAppStore().getState().messages` — a read that never re-renders. It stays
 * a module-level helper for the slices, which are not reactive consumers.
 *
 * Listener fan-out is a plain `Set`, not `watch`. `watch` routes the callback
 * through Vue's `callWithAsyncErrorHandling`, which rethrows in development but
 * merely `console.error`s in production; a throwing reconcile listener would
 * then be swallowed and the `setState` caller would keep going as if the commit
 * had succeeded. `Set.forEach` semantics — synchronous, and a
 * throw reaching the caller — are what the boot error handling depends on, so
 * they are reproduced here verbatim.
 */
export const useAppStore = defineStore("app", () => {
  /**
   * Starts undefined: `buildInitialState()` runs once the runtimes exist and
   * commits through `commitInitialState`. The composed object is assigned only
   * after every slice has contributed its members. The `undefined` is typed
   * honestly rather than asserted away, so an early read fails loudly instead of
   * yielding `undefined.foo`.
   * `undefined.foo`.
   */
  const appState = shallowRef<AppState | undefined>(undefined);

  const appStoreListeners = new Set<
    (state: AppState, previous: AppState) => void
  >();

  function setState(
    update: Partial<AppState> | ((state: AppState) => Partial<AppState>),
  ): void {
    const previous = appState.value;
    if (!previous) {
      throw new Error("app store set before the initial state was committed");
    }
    const partial = typeof update === "function" ? update(previous) : update;
    if (Object.is(partial, previous)) return;
    const next = { ...previous, ...partial };
    appState.value = next;
    appStoreListeners.forEach((listener) => listener(next, previous));
  }

  /** Register a listener; the returned function unsubscribes it. */
  function subscribe(
    listener: (state: AppState, previous: AppState) => void,
  ): () => void {
    appStoreListeners.add(listener);
    return () => {
      appStoreListeners.delete(listener);
    };
  }

  function commitInitialState(state: AppState): void {
    appState.value = state;
  }

  return { appState, setState, subscribe, commitInitialState };
});

/**
 * The store instance, created on first use rather than at module scope.
 *
 * Pinia applies plugins at store-creation time, and `pinia.use(...)` calls made
 * before `app.use(pinia)` sit in a "to be installed" queue that is only
 * flushed during `app.use`. Instantiating at module scope would therefore
 * create the app store before that flush, so no plugin (including Pinia's own
 * devtools action timeline) would ever apply to it. Creating it lazily on first
 * access — which happens from a component during mount, after
 * `app.use(rendererPinia)` — keeps the store plugin-eligible.
 *
 * The initial commit and the reconciliation subscription live here so they run
 * exactly once, in order, against the instance the renderer actually uses.
 */
let appStoreInstance: ReturnType<typeof useAppStore> | null = null;

function appStore(): ReturnType<typeof useAppStore> {
  if (appStoreInstance) return appStoreInstance;
  const store = useAppStore(rendererPinia);
  store.commitInitialState(buildInitialState());
  /** Reconcile reading views and canonical caches at the same publication boundary. */
  store.subscribe((state, previous) => {
    transcriptReading.reconcile(state, previous);
    sessionRuntime.syncTranscriptProjection(state, previous);
  });
  appStoreInstance = store;
  return store;
}

/** Live composed state. */
function getState(): AppState {
  const state = appStore().appState;
  if (!state) {
    throw new Error("app store read before the initial state was committed");
  }
  return state;
}

/** Merge-style update. */
function setState(
  update: Partial<AppState> | ((state: AppState) => Partial<AppState>),
): void {
  appStore().setState(update);
}

/** Store access handed to the runtimes and slices. */
const storeAccess: StoreAccess = { get: getState, set: setState };
const sessionRuntime: SessionRuntime = createSessionRuntime(storeAccess);
const catalogRuntime: CatalogRuntime = createCatalogRuntime();
const interactionRuntime: InteractionRuntime = createInteractionRuntime();
const titleRuntime = createSessionTitleRuntime({
  ...storeAccess,
  sessionRuntime,
  initialSessionMeta: initialSidebarPreferences.sessionMeta,
});
const manuallyRenamedSessionIds = titleRuntime.manualSessionTitles;
const { triggerAutoTitleSummarization } = titleRuntime;
const notifyInteractivePrompt = createInteractivePromptNotifier(
  storeAccess.get,
);
const sessionCoordination: SessionCoordination = createSessionCoordination({
  ...storeAccess,
  runtime: sessionRuntime,
  decorateSessions,
  withoutRecordKey,
  untitledTaskTitle,
});
const {
  flushPendingSessionConfiguration,
  rememberSessionCompactions,
  commitForkedSession,
  persistSessionAndSelect,
  materializeDraftSession: materializeDraftSessionInternal,
} = sessionCoordination;

const transcriptReading = createTranscriptReadingRuntime(storeAccess, api.getSession);

function buildInitialState(): AppState {
  const get = getState;
  const set = setState;
  return {
  ...createInitialState(),
  ...transcriptReading.actions,

  ...createSessionSlice({
    get,
    set,
    runtime: sessionRuntime,
    decorateSessions,
    withoutRecordKey,
    sessionModeForPlanningState,
    openPlanArtifact,
    rememberSessionCompactions,
    commitForkedSession,
    persistSessionAndSelect,
  }),

  ...createQueueSlice({
    get,
    set,
    runtime: sessionRuntime,
    promptAttachmentsFromDraft,
    withoutRecordKey,
    promptFallbackSessionTitle,
    untitledTaskTitle,
    isDefaultSessionTitle,
    viewingSessionIdForPrompt,
    messageErrorFromUnknown,
    assistantErrorMessage,
    materializeDraftSession: materializeDraftSessionInternal,
  }),

  ...createTranscriptSlice({
    get,
    set,
    runtime: sessionRuntime,
    promptAttachmentsFromMessage,
    viewingSessionIdForPrompt,
    flushPendingSessionConfiguration,
  }),

  ...createProjectSlice({
    get,
    set,
    runtime: sessionRuntime,
    manualSessionTitles: manuallyRenamedSessionIds,
    withoutRecordKey,
    withProjectDisplayName,
    promoteProjectPath,
    removeProjectPath,
    upsertWorkspace,
    persistCurrentSidebar,
  }),

  ...createCatalogSlice({
    get,
    set,
    catalogRuntime,
    sessionRuntime,
    decorateSessions,
    withoutRecordKey,
  }),

  ...createEventsSlice({
    get,
    set,
    runtime: sessionRuntime,
    withoutRecordKey,
    sessionModeForPlanningState,
    openPlanArtifact,
    notifyInteractivePrompt,
    triggerAutoTitleSummarization,
    flushPendingSessionConfiguration,
    assistantErrorMessage,
    withCompactionMark,
  }),

  ...createInteractionSlice({
    get,
    set,
    runtime: sessionRuntime,
    interactionRuntime,
  }),

  bootstrap: async () => {
    let recoveredSettings: AppSettings | undefined;
    try {
      const settingsRequest = api.getSettings().then(async (settingsRaw) => {
        let settings = settingsRaw
          ? {
              ...settingsRaw,
              defaultMode: normalizeMode(
                (settingsRaw as { defaultMode?: unknown }).defaultMode,
              ),
              // Persisted keybindings can still name the retired window ids
              // (D438); every renderer reader sees the migrated map, and the next
              // shortcut save writes that shape back.
              keybindings: migrateKeybindingOverrides(settingsRaw.keybindings),
            }
          : settingsRaw;
        // First-run default per D003: Agent. Never force-rewrite an existing
        // user choice on boot.
        if (settings && !settings.defaultMode) {
          const next = { ...settings, defaultMode: "agent" as const };
          try {
            await api.setSettings(next);
            settings = next;
          } catch {
            settings = next;
          }
        }
        return settings;
      });
      const snapshotRequest = Promise.all([
        api.getVersion(),
        api.health(),
        api.listSessions(),
        api.listProviders(),
        api.getProject(),
        api.getOnboarding(),
        api.listPlugins(),
        api.listNotifications({ limit: 200 }),
        api.pendingPlans(),
      ]);
      const bootstrapResult = await settleBootstrapRequests(
        settingsRequest,
        snapshotRequest,
      );
      recoveredSettings = bootstrapResult.settings;
      if (!bootstrapResult.ok) {
        throw bootstrapResult.error;
      }
      const settings = bootstrapResult.settings;
      const [
        version,
        health,
        sessions,
        providers,
        project,
        onboarding,
        plugins,
        notifications,
        pendingPlansResult,
      ] = bootstrapResult.snapshot;
      if (version.protocolVersion !== PROTOCOL_VERSION) {
        set({
          error: `Protocol mismatch: UI ${PROTOCOL_VERSION} vs app ${version.protocolVersion}`,
          errorCode: "PROTOCOL_MISMATCH",
        });
      }
      const cachedProviderModels = Object.fromEntries(
        (
          await Promise.all(
            providers.providers.map(async (provider) => {
              try {
                const cached = await api.listProviderModels({
                  providerId: provider.id,
                  source: "cache",
                });
                return cached.models.length > 0
                  ? ([provider.id, cached.models] as const)
                  : null;
              } catch {
                return null;
              }
            }),
          )
        ).filter((entry): entry is readonly [string, ModelInfo[]] => entry !== null),
      );
      const currentWorkspace = project.workspace
        ? withProjectDisplayName(project.workspace, get().projectMeta)
        : null;
      const persistedPaths = get().openProjectPaths;
      // Only explicitly retained tabs are restored. Historical sessions stay
      // available in Projects, but must not silently reopen a tab that was
      // intentionally closed.
      const openProjectPaths = currentWorkspace?.path
        ? promoteProjectPath(persistedPaths, currentWorkspace.path)
        : persistedPaths;
      const openProjects = openProjectPaths.map((path) =>
        withProjectDisplayName(projectWorkspaceFromPath(path), get().projectMeta),
      );
      const hydratedProjects = currentWorkspace
        ? upsertWorkspace(openProjects, currentWorkspace)
        : openProjects;
      const hydratedSessions = decorateSessions(sessions.sessions, get().sessionMeta);
      const latestPlanCheckpoints = Object.fromEntries(
        hydratedSessions.flatMap((session) => {
          const proposal = latestPlanProposal(
            pendingPlansResult.plans,
            session.id,
          );
          return proposal ? [[session.id, proposal] as const] : [];
        }),
      );
      const activePendingPlans = pendingPlansResult.plans.filter(isPendingPlan);
      const pendingPlans = Object.fromEntries(
        activePendingPlans.map((proposal) => [proposal.sessionId, proposal]),
      );
      const planningStates: Record<string, PlanningState> = Object.fromEntries(
        hydratedSessions.map((session) => [
          session.id,
          session.mode === "plan" ? ("planning" as const) : ("inactive" as const),
        ]),
      );
      for (const proposal of activePendingPlans) {
        planningStates[proposal.sessionId] = "awaiting_approval";
      }
      set({
        ready: true,
        version,
        healthOk: health.ok,
        settings,
        sessions: hydratedSessions,
        providers: providers.providers,
        providerModels: cachedProviderModels,
        workspace: currentWorkspace,
        activeProjectPath: currentWorkspace?.path,
        openProjectPaths,
        openProjects: hydratedProjects,
        onboarding,
        plugins: plugins.plugins,
        planningStates,
        pendingPlans,
        planCheckpoints: latestPlanCheckpoints,
        notifications: notifications.notifications,
        unreadNotificationCount: notifications.unreadCount,
        sessionOutcomes: latestSessionOutcomes(notifications.notifications),
      });

      // The artifact's surface depends on which plugin views are launchable, and
      // the launcher list is only read after `ready`. Resolve it before the
      // restore, so the approval artifact does not fall back to the host file tab
      // and then take a second tab from `selectSession`.
      await get().refreshPluginViews();
      for (const proposal of activePendingPlans) {
        openPlanArtifact(
          proposal,
          get().openWorkPanelTabForSession,
          get().pluginViews,
        );
      }
      saveSidebarPreferences(preferencesFromState(get()));
      if (currentWorkspace?.path) {
        rememberProject({
          path: currentWorkspace.path,
          name: currentWorkspace.name || currentWorkspace.path,
          branch: currentWorkspace.branch,
        });
      }
      // Codex opens an empty draft home ("What can I help you build?") rather than
      // restoring a prior transcript as the first paint. A live host plan is
      // the exception: its owning session must be visible so approval can be
      // restored after a renderer reload.
      const livePlanSessionId = activePendingPlans[0]?.sessionId;
      if (livePlanSessionId) {
        await get().selectSession(livePlanSessionId);
      } else {
        // App startup keeps the home composer unpersisted. Explicit New Task
        // actions use the durable empty-session slot below, but launch itself
        // must not create a history row merely because the app was opened.
        set((s) => {
          const stack = s.navStack.slice(0, s.navIndex + 1);
          const nextStack = [...stack, { page: "chat" as const }].slice(-50);
          return {
            ...switchWorkPanelSession(s, undefined),
            ...clearSessionPanes(),
            activeSessionId: undefined,
            draftConfiguration: null,
            messages: [],
            page: "chat" as const,
            navStack: nextStack,
            navIndex: nextStack.length - 1,
            isRunning: false,
          };
        });
      }
    } catch (e) {
      set({
        ready: true,
        healthOk: false,
        ...(recoveredSettings ? { settings: recoveredSettings } : {}),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  ...createWorkPanelSlice({
    get,
    set,
    isSessionSelectionPending: (sessionId) =>
      sessionRuntime.isSessionSelectionPending(sessionId),
  }),


  clearComposerPrefill: () => set({ composerPrefill: null }),
  };
}


/**
 * Build the composed state and register the reconciliation subscription.
 *
 * Called once from the renderer entry point, immediately after
 * `app.use(rendererPinia)`, so the store is created while plugins are
 * installed and the initial state exists before the first paint. Idempotent:
 * later calls (and the lazy path below) reuse the same instance.
 */
export function initializeAppStore(): void {
  appStore();
}

export async function materializeDraftSession(
  intent?: number,
): Promise<string | null> {
  return sessionCoordination.materializeDraftSession(intent);
}


/**
 * `lib/commands.ts` reaches the composed store through these two thin wrappers
 * instead of a component-level `useAppStore()`; both go through the store's
 * `getState()` / `setState(...)`.
 */
export function currentAppState(): AppState {
  return getState();
}

export function patchAppState(
  update: Partial<AppState> | ((state: AppState) => Partial<AppState>),
): void {
  setState(update);
}
