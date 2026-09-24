<script lang="ts">
/**
 * The module's re-exported surface.
 *
 * This module re-exports `THINKING_LEVELS`, `thinkingLevelForProvider`,
 * `thinkingProviderForModel` and the `ComposerPrefill` type so callers could
 * reach them through the composer. `<script setup>` cannot export, so the same
 * four names are re-exported from this plain block. Nothing in dcode imports
 * them from here yet — the one importer (`ChatSurface`) imports only
 * `Composer` — but the module surface is kept whole.
 */
export {
  THINKING_LEVELS,
  thinkingLevelForProvider,
  thinkingProviderForModel,
  type ComposerPrefill,
} from "../features/chat/composer/model";
</script>

<script setup lang="ts">
/**
 * Composer: the prompt editor, its toolbar, its status rows and its queue.
 *
 * The `Composer` component. The decisions that are not mechanical:
 *
 * 1. **Props, and no emits.** The signature is
 *     `{ variant?: "home" | "docked"; prefill?: ComposerPrefill | null }` with
 *     `variant` defaulting to `"docked"`; it declares no callback prop, so this
 *     SFC declares the same two props and no emit. `ChatSurface` renders
 *     `<StableComposer variant="home" />` and `variant="docked"`; `memo` has no
 *     Vue counterpart and is dropped at that call site. `className` is never
 * passed here, and the root is a single `<div>`, so attribute
 *     fallthrough lands there unchanged.
 *  2. **Every store read is a `computed` projection over `store.appState`**, in
 * the order the store selectors run, so the derivation chain below
 *     reads like the selector chain. `appState` is a shallow ref, so each
 *     projection tracks the commit rather than the object identity.
 *  3. **Store actions are read through `currentAppState()` at call time.** The
 *     earlier version selected each action once per render; a Vue setup runs once, and
 *     the controllers this component feeds (`useComposerSubmit`, the toolbar,
 *     the status rows) require the action itself rather than a getter, so each
 *     action is wrapped in a same-signature function that reads the live store
 *     when it is called. `currentAppState()` is the exported counterpart of the
 *     store `getState()`; `getState()` itself stays off limits for a
 *     component.
 *  4. **The dock and shell class lists are bindings, not template literals.**
 * The earlier version glued `` `composer-dock-${variant}` `` and
 *     `` `composer-shell${inputBlocked ? " is-gated" : ""}` ``; the class
 *     contract reads a static `class` plus an object/ternary `:class` as the
 *     class names they are; the rendered DOM is the same. The
 *     `composer-placeholder` fade key is a `computed` for the same reason
 *     `ComposerInput.vue` keeps `:key`.
 * 5. **`useLayoutEffect` -> `watch(., { flush: "post" })`.** The composer's
 *     autosize runs after the DOM update and before paint, the same window the
 *     earlier version measured in; the mount half is `onMounted`, because the
 *     layout effect also ran once on mount (a draft restored from
 *     the module cache is non-empty at that point and must be measured).
 *  6. **The dock-height effect is `onMounted` + a `ResizeObserver`.** The
 *     effect re-ran on `[variant]`; variant never changes for an instance
 *     in practice (a branch flip remounts the composer), so the watcher only
 *     republishes the height.
 *  7. **The draft controller's options are getters.** `useComposerDraft`
 *     declares `activeSessionId` / `workspacePath` / `sessions` /
 *     `composerPrefill` / `prefill` / `inputBlocked` as `MaybeRefOrGetter`s and
 *     derives `draftKey` / `referenceSessionId` from `toValue(activeSessionId)`
 *     as computeds, which a per-render body provides for
 *     free. They are passed as `() => x.value` rather than read at setup, so the
 *     controller's own `[draftKey, referenceSessionId]` watcher fires on a
 * session switch and swaps the composer draft exactly as the effect
 *     did.
 *  8. **`onSubmit(steering?)` keeps its optional payload.** `ComposerInput`'s
 *     alt+enter branch sends `runActive` and the plain enter branch sends
 * nothing, in the same way as the called `onSubmit(runActive)` / `onSubmit()`.
 * 9. `composer-status` and `is-gated` are class names on the
 *     read-only banner and the gated shell; neither the stylesheet nor
 * the `styles/*.css` defines either, so they carry no rule in
 *     this tree (reported, not replaced).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Mode, PermissionMode, PlanProposal } from "@dcode/shared";
import {
  initialThinkingLevelForBinding,
  modelIdsMatch,
  normalizeLargePasteThreshold,
  stripInlineComposerFileReferenceTokens,
} from "@dcode/shared";
import {
  currentAppState,
  useAppStore,
  type AppState,
} from "../stores/app-store";
import { latestTurnContextInspector } from "../lib/latest-turn-context";
import { isActivePlanExecution } from "../lib/plan-mode-state";
import { headAsk, queuedAskCount } from "../lib/pending-asks";
import type { QueuedPrompt } from "../lib/queued-prompts";
import {
  composerModelDisplayName,
  composerModelsForProvider,
} from "../lib/composer-models";
import {
  providerThinkingLevels,
  resolveComposerThinkingProvider,
} from "../lib/session-thinking";
import { useComposerAutocomplete } from "../hooks/use-composer-autocomplete";
import ComposerAutocomplete from "./ComposerAutocomplete.vue";
import AskToolCard from "./AskToolCard.vue";
import PlanApprovalBar from "./PlanApprovalBar.vue";
import {
  COMPOSER_MAX_VISIBLE_ROWS,
  COMPOSER_MIN_HEIGHT_PX,
  PLACEHOLDER_KEYS,
  cssPixels,
  isPermissionMode,
  isThinkingLevel,
  thinkingLevelForProvider,
  thinkingProviderForModel,
  type ComposerPrefill,
} from "../features/chat/composer/model";
import {
  createFileReference,
  editorSelectionRange,
  isImageFilePath,
  nextChipToken,
} from "../features/chat/composer/editor";
import { useComposerAttachments } from "../features/chat/composer/hooks/useComposerAttachments";
import { useComposerDraft } from "../features/chat/composer/hooks/useComposerDraft";
import { useComposerSubmit } from "../features/chat/composer/hooks/useComposerSubmit";
import { useComposerModelMenu } from "../features/chat/composer/hooks/useComposerModelMenu";
import ComposerInput from "../features/chat/composer/ComposerInput.vue";
import ComposerImageAttachments from "../features/chat/composer/ComposerImageAttachments.vue";
import ComposerToolbar from "../features/chat/composer/ComposerToolbar.vue";
import ComposerStatus from "../features/chat/composer/ComposerStatus.vue";

const EMPTY_QUEUED_PROMPTS: QueuedPrompt[] = [];

const props = withDefaults(
  defineProps<{
    variant?: "home" | "docked";
    prefill?: ComposerPrefill | null;
  }>(),
  { variant: "docked", prefill: null },
);

const { t } = useI18n();
const store = useAppStore();

/* ------------------------------------------------------------------ */
/* Store projections (note 2)                                          */
/* ------------------------------------------------------------------ */

const settings = computed(() => store.appState?.settings);
const sessions = computed(() => store.appState?.sessions ?? []);
const activeSessionId = computed(() => store.appState?.activeSessionId);
const workspacePath = computed(() => store.appState?.workspace?.path ?? "");
const providers = computed(() => store.appState?.providers ?? []);
const providerModels = computed(() => store.appState?.providerModels ?? {});
const liveMessages = computed(() => store.appState?.messages ?? []);
const sessionCompactions = computed(() => {
  const id = store.appState?.activeSessionId;
  return id ? store.appState?.sessionCompactions[id] : undefined;
});
const planningState = computed(() => {
  const id = store.appState?.activeSessionId;
  return id ? store.appState?.planningStates[id] : undefined;
});
const planCheckpoint = computed<PlanProposal | undefined>(() => {
  const id = store.appState?.activeSessionId;
  return id ? store.appState?.planCheckpoints[id] : undefined;
});
const pendingAsk = computed(() =>
  headAsk(store.appState?.pendingAsks ?? {}, store.appState?.activeSessionId),
);
const queuedAsks = computed(() =>
  queuedAskCount(store.appState?.pendingAsks ?? {}, store.appState?.activeSessionId),
);
const queuedPrompts = computed<QueuedPrompt[]>(() => {
  const id = store.appState?.activeSessionId;
  if (!id) return EMPTY_QUEUED_PROMPTS;
  return store.appState?.queuedPrompts[id] ?? EMPTY_QUEUED_PROMPTS;
});
const draftConfiguration = computed(() => store.appState?.draftConfiguration);
const composerPrefill = computed(() => store.appState?.composerPrefill ?? null);
const isRunning = computed(() => store.appState?.isRunning ?? false);
const activeSessionSummary = computed(() =>
  sessions.value.find((session) => session.id === activeSessionId.value),
);
const nativeSession = computed(() => activeSessionSummary.value?.source === "pi-native");
const nativeReadOnly = computed(
  () => nativeSession.value && activeSessionSummary.value?.capabilities?.canPrompt !== true,
);
const nativeInputBlocked = computed(
  () => nativeReadOnly.value || (nativeSession.value && isRunning.value),
);

// One inspector in the composer toolbar, always the newest turn with usage.
const composerContextUsage = computed(() =>
  latestTurnContextInspector(
    liveMessages.value,
    providerModels.value,
    providers.value,
    sessionCompactions.value,
  ),
);

/* ------------------------------------------------------------------ */
/* Store actions (note 3)                                              */
/* ------------------------------------------------------------------ */

const sendPrompt: AppState["sendPrompt"] = (content, draft, targetSessionId) =>
  currentAppState().sendPrompt(content, draft, targetSessionId);
const steerPrompt: AppState["steerPrompt"] = (content, draft) =>
  currentAppState().steerPrompt(content, draft);
const removeQueuedPrompt: AppState["removeQueuedPrompt"] = (promptId) =>
  currentAppState().removeQueuedPrompt(promptId);
const moveQueuedPrompt: AppState["moveQueuedPrompt"] = (promptId, direction) =>
  currentAppState().moveQueuedPrompt(promptId, direction);
const editQueuedPrompt: AppState["editQueuedPrompt"] = (promptId) =>
  currentAppState().editQueuedPrompt(promptId);
const sendQueuedNow: AppState["sendQueuedNow"] = (promptId) =>
  currentAppState().sendQueuedNow(promptId);
const abort: AppState["abort"] = () => currentAppState().abort();
const configureActiveSession: AppState["configureActiveSession"] = (config) =>
  currentAppState().configureActiveSession(config);
const showToast: AppState["showToast"] = (message, options) =>
  currentAppState().showToast(message, options);
const clearComposerPrefill: AppState["clearComposerPrefill"] = () =>
  currentAppState().clearComposerPrefill();
 /* The approval bar takes a non-null proposal; this is the `v-if` for that. */
const pendingProposal = computed(() =>
  planCheckpoint.value?.status === "pending" ? planCheckpoint.value : null,
);

/* ------------------------------------------------------------------ */
/* Draft, attachments, submit                                          */
/* ------------------------------------------------------------------ */

const permissionOpen = ref(false);
const enhancementInvalidateRef = ref<() => void>(() => {});
const composerShellRef = ref<HTMLDivElement | null>(null);
const dockRef = ref<HTMLDivElement | null>(null);
const publishedDockHeightRef = ref(-1);

function invalidatePromptEnhancement(): void {
  enhancementInvalidateRef.value();
}

const approvalPending = computed(() => planCheckpoint.value?.status === "pending");
const largePasteThreshold = computed(() =>
  normalizeLargePasteThreshold(settings.value?.largePasteThreshold),
);

const draft = useComposerDraft({
  variant: props.variant,
  activeSessionId: () => activeSessionId.value,
  workspacePath: () => workspacePath.value,
  sessions: () => sessions.value,
  composerPrefill: () => composerPrefill.value,
  clearComposerPrefill,
  prefill: () => props.prefill,
  invalidatePromptEnhancement,
  inputBlocked: () => approvalPending.value || nativeInputBlocked.value,
});

/*
 * The controller exposes `value` / `cursor` / `inputFocused` as getters over
 * the hook's internal refs, not as refs of their own, so a template must read
 * them through the object. These two projections keep the template free of a
 * `.value` that could be mistaken for a double unwrap.
 */
const draftValue = computed(() => draft.value);
const inputFocused = computed(() => draft.inputFocused);
 /* The earlier version glued `` `composer-dock-${variant}` ``; the two names are spelled
 * out so the class contract reads them (see note 4). */
const isHomeVariant = computed(() => props.variant === "home");

const attachments = useComposerAttachments({
  inputBlocked: () => approvalPending.value || nativeSession.value,
  activeSessionId,
  draftKey: () => draft.draftKey,
  largePasteThreshold,
  draft: {
    ref: draft.ref,
    valueRef: draft.valueRef,
    fileReferencesRef: draft.fileReferencesRef,
    applyEditorDraft: draft.applyEditorDraft,
    snapshotReferences: draft.snapshotReferences,
    commitEditorDom: draft.commitEditorDom,
  },
});

const {
  pasting,
  dropTargetActive,
  droppedDirectories,
  pickAndAttach,
  pasteClipboardFiles,
  onComposerDragEnter,
  onComposerDragOver,
  onComposerDragLeave,
  onComposerDrop,
  openDroppedFolderAsProject,
  insertDroppedDirectoryPaths,
  dismissDroppedDirectories,
} = attachments;

const executionActive = computed(() => isActivePlanExecution(planCheckpoint.value));
const runActive = computed(() => isRunning.value || executionActive.value);
const inputBlocked = computed(
  () => approvalPending.value || pasting.value || nativeInputBlocked.value,
);
const controlsBlocked = computed(() => approvalPending.value || nativeSession.value);
const sendBlocked = computed(
  () => approvalPending.value || pasting.value || nativeInputBlocked.value,
);
const enhancementDraft = computed(() =>
  stripInlineComposerFileReferenceTokens(draft.value, draft.activeFileReferences),
);

/**
 * Edit returns one queued row to the composer. The row is removed and its
 * captured draft becomes the input, so the input must be empty first: the live
 * read is the only current source (the draft cache is not per keystroke).
 */
function handleEditQueuedPrompt(id: string): void {
  if (draft.readLiveDraft().trim() || draft.activeFileReferences.length) {
    showToast(t("chat.editQueuedPromptBusy"), { variant: "info" });
    return;
  }
  editQueuedPrompt(id);
}

const placeholderKeys = computed(() => PLACEHOLDER_KEYS[props.variant]);
const placeholderKey = computed(() => {
  const keys = placeholderKeys.value;
  return keys[draft.placeholderIndex % keys.length] ?? keys[0];
});
const placeholderText = computed(() => t(placeholderKey.value));
 /* Bound as `:key`, so a copy change restarts the fade. */
const placeholderRenderKey = computed(
  () => `${props.variant}-${draft.placeholderIndex}-${placeholderText.value}`,
);

/* ------------------------------------------------------------------ */
/* Editor autosize (note 5)                                            */
/* ------------------------------------------------------------------ */

let textareaMetrics: { lineHeight: number; verticalChrome: number } | null = null;
let appliedHeight: number | null = null;
let appliedOverflow: string | null = null;

function resizeComposerInput(): void {
  const el = draft.ref.value;
  if (!el) return;
  let metrics = textareaMetrics;
  if (!metrics) {
    const style = window.getComputedStyle(el);
    metrics = {
      lineHeight: cssPixels(style.lineHeight) || COMPOSER_MIN_HEIGHT_PX,
      verticalChrome:
        cssPixels(style.paddingTop) +
        cssPixels(style.paddingBottom) +
        cssPixels(style.borderTopWidth) +
        cssPixels(style.borderBottomWidth),
    };
    textareaMetrics = metrics;
  }
  const maxHeight = Math.ceil(
    metrics.lineHeight * COMPOSER_MAX_VISIBLE_ROWS + metrics.verticalChrome,
  );
  const applied =
    appliedHeight !== null && el.style.height === `${appliedHeight}px`
      ? appliedHeight
      : null;
  let content = applied === null ? -1 : el.scrollHeight;
  if (
    applied === null ||
    (content <= el.clientHeight && applied > COMPOSER_MIN_HEIGHT_PX)
  ) {
    el.style.height = "auto";
    content = el.scrollHeight;
  }
  const next = Math.max(COMPOSER_MIN_HEIGHT_PX, Math.min(content, maxHeight));
  const overflowY = content > maxHeight ? "auto" : "hidden";
  if (appliedHeight !== next || el.style.height !== `${next}px`) {
    el.style.height = `${next}px`;
    appliedHeight = next;
  }
  if (appliedOverflow !== overflowY) {
    el.style.overflowY = overflowY;
    appliedOverflow = overflowY;
  }
}

onMounted(resizeComposerInput);
watch(draftValue, resizeComposerInput, { flush: "post" });

/* ------------------------------------------------------------------ */
/* Session configuration chain                                         */
/* ------------------------------------------------------------------ */

const activeSession = computed(() =>
  sessions.value.find((session) => session.id === activeSessionId.value),
);
const mode = computed<Mode>(() =>
  activeSession.value
    ? activeSession.value.mode
    : (draftConfiguration.value?.mode ?? settings.value?.defaultMode ?? "agent"),
);
const planningLive = computed(
  () =>
    isRunning.value &&
    planningState.value === "planning" &&
    (mode.value === "plan" || mode.value === "goal"),
);
// Permission mode (D115/D132): inherited sessions still resolve through the
// global setting, but the composer presents only the effective mode.
const globalPermissionMode = computed<PermissionMode>(
  () => settings.value?.defaultPermissionMode ?? "ask",
);
const sessionPermissionMode = computed<PermissionMode>(() =>
  activeSession.value
    ? isPermissionMode(activeSession.value.permissionMode)
      ? activeSession.value.permissionMode
      : "inherit"
    : isPermissionMode(draftConfiguration.value?.permissionMode)
      ? draftConfiguration.value.permissionMode
      : "inherit",
);
const effectivePermissionMode = computed<Exclude<PermissionMode, "inherit">>(() =>
  sessionPermissionMode.value === "inherit"
    ? (globalPermissionMode.value as Exclude<PermissionMode, "inherit">)
    : sessionPermissionMode.value,
);
const composerPermissionMode = computed<Exclude<PermissionMode, "inherit">>(() =>
  mode.value === "goal" ? "auto" : effectivePermissionMode.value,
);
const provider = computed(() =>
  providers.value.find(
    (candidate) =>
      candidate.id ===
      (activeSession.value?.providerId ??
        (!activeSession.value ? draftConfiguration.value?.providerId : undefined) ??
        settings.value?.defaultProviderId),
  ),
);
const modelId = computed(
  () =>
    activeSession.value?.modelId ??
    (!activeSession.value ? draftConfiguration.value?.modelId : undefined) ??
    settings.value?.defaultModelId ??
    provider.value?.defaultModelId,
);
const selectedModelCatalog = computed(() =>
  provider.value ? providerModels.value[provider.value.id] : undefined,
);
const catalogThinkingProvider = computed(() =>
  thinkingProviderForModel(provider.value, modelId.value, selectedModelCatalog.value),
);
const thinkingProvider = computed(() =>
  resolveComposerThinkingProvider({
    provider: provider.value,
    modelId: modelId.value,
    activeSession: activeSession.value,
    catalogThinkingProvider: catalogThinkingProvider.value,
  }),
);
const selectedBinding = computed(() =>
  provider.value?.models.find((candidate) =>
    modelIdsMatch(candidate.id, modelId.value ?? ""),
  ),
);
// A draft without a session starts at the selected model's stored default
// thinking level, clamped onto that binding's enabled ladder.
const draftThinkingLevel = computed(() =>
  initialThinkingLevelForBinding(
    selectedBinding.value,
    thinkingProvider.value?.supportedThinkingLevels,
  ),
);
const sessionThinkingLevel = computed(
  () =>
    activeSession.value?.thinkingLevel ??
    (!activeSession.value ? draftConfiguration.value?.thinkingLevel : undefined) ??
    draftThinkingLevel.value,
);
const configuredThinkingLevel = computed(() =>
  isThinkingLevel(sessionThinkingLevel.value) ? sessionThinkingLevel.value : "off",
);
const availableThinkingLevels = computed(() =>
  providerThinkingLevels(thinkingProvider.value),
);
const thinkingLevel = computed(() =>
  thinkingLevelForProvider(thinkingProvider.value, configuredThinkingLevel.value),
);
const thinkingLabel = computed(() => thinkingLevel.value);
const selectedModel = computed(() => {
  const current = provider.value;
  if (!current?.id) return undefined;
  return composerModelsForProvider(current, providerModels.value[current.id]).find(
    (model) => modelIdsMatch(model.modelId, modelId.value ?? ""),
  );
});
const modelLabel = computed(() => {
  const current = provider.value;
  if (current && modelId.value) {
    return composerModelDisplayName(current, modelId.value, selectedModel.value?.displayName);
  }
  return selectedModel.value?.displayName || modelId.value || t("chat.model");
});
const modelMenu = useComposerModelMenu({
  mode,
  activeSessionId,
  provider,
  modelId,
  thinkingProvider,
  thinkingLevel,
  controlsBlocked,
});
const modelReady = computed(() =>
  nativeSession.value
    ? activeSessionSummary.value?.capabilities?.canPrompt === true
    : Boolean(
        provider.value &&
          provider.value.enabled &&
          modelId.value &&
          (provider.value.hasSecret || provider.value.authKind === "none"),
      ),
);
const enterToSend = computed(() => settings.value?.enterToSend ?? true);
/*
  Chips occupy sentinel characters, which `trim()` preserves — but an image
  attachment has no chip (78a073a5 detaches it from the text), so an image-only
  draft would otherwise look empty and disable Send.
*/
const hasDraftContent = computed(
  () => Boolean(draft.value.trim() || draft.activeFileReferences.length),
);
watch(controlsBlocked, (blocked) => {
  if (blocked) permissionOpen.value = false;
});

const submitController = useComposerSubmit({
  value: () => draft.value,
  draftKey: () => draft.draftKey,
  activeSessionId,
  providerId: () => provider.value?.id,
  modelId,
  thinkingLevel,
  modelReady,
  sendBlocked,
  pasting,
  activeFileReferences: () => draft.activeFileReferences,
  sendPrompt,
  steerPrompt,
  showToast,
  draft: {
    ref: draft.ref,
    draftSnapshot: draft.draftSnapshot,
    clearDraftForKey: draft.clearDraftForKey,
    restoreDraftForKey: draft.restoreDraftForKey,
    setValue: draft.setValue,
    setCursor: draft.setCursor,
  },
});
enhancementInvalidateRef.value = submitController.invalidatePromptEnhancement;

const {
  enhancingPrompt,
  enhancementUndoText,
  enhancementError,
  clearEnhancementError,
  enhancePrompt,
  undoPromptEnhancement,
  submit,
} = submitController;

const composerAc = useComposerAutocomplete({
  value: () => draft.value,
  cursor: () => draft.cursor,
  composing: () => draft.composing,
  enabled: () => !inputBlocked.value,
});

function acceptCompletion(index: number): void {
  const result = composerAc.accept(index);
  if (!result) return;
  invalidatePromptEnhancement();
  // File accept strips the @ token (empty insert) and used to store a
  // token-less chip above the textarea. Inline chips only paint when a
  // sentinel is in the draft, so Enter looked like the reference vanished.
  const acceptedFileReference = result.fileReference;
  if (!acceptedFileReference) {
    draft.applyEditorDraft(result.value, draft.fileReferencesRef.value, result.cursor);
    return;
  }
  const token = nextChipToken();
  const nextText =
    result.value.slice(0, result.cursor) + token + result.value.slice(result.cursor);
  draft.applyEditorDraft(
    nextText,
    [
      ...draft.fileReferencesRef.value,
      createFileReference(
        acceptedFileReference.path,
        acceptedFileReference.name,
        draft.referenceSessionId,
        {
          kind: isImageFilePath(acceptedFileReference.path) ? "image" : "file",
          token,
        },
      ),
    ],
    result.cursor + token.length,
  );
}

/* ------------------------------------------------------------------ */
/* Event handlers                                                      */
/* ------------------------------------------------------------------ */

function onComposerInputSubmit(steering?: boolean): void {
  void submit(steering);
}

function onCompositionEnd(event: CompositionEvent): void {
  draft.setComposing(false);
  draft.updateCursor(
    editorSelectionRange(event.currentTarget as HTMLElement).start,
  );
}

function onInputBlur(): void {
  draft.setInputFocused(false);
  draft.persistDraft();
}

function setPermissionOpen(next: boolean | ((current: boolean) => boolean)): void {
  permissionOpen.value = typeof next === "function" ? next(permissionOpen.value) : next;
}

/* ------------------------------------------------------------------ */
/* Dock height (note 6)                                                */
/* ------------------------------------------------------------------ */

/**
 * Keep the transcript's bottom reserve in sync with the composer's real height
 * (it grows with multi-line input) so the last message sits just above the box
 * instead of far below it. Setting a custom property on `documentElement`
 * invalidates style for the whole document, so an unchanged dock height must
 * not be republished.
 */
function publishDockHeight(): void {
  const el = dockRef.value;
  if (!el) return;
  const height = Math.round(el.getBoundingClientRect().height);
  if (height === publishedDockHeightRef.value) return;
  publishedDockHeightRef.value = height;
  document.documentElement.style.setProperty("--composer-dock-height", `${height}px`);
}

let dockObserver: ResizeObserver | null = null;

onMounted(() => {
  publishDockHeight();
  if (typeof ResizeObserver === "undefined") return;
  dockObserver = new ResizeObserver(publishDockHeight);
  if (dockRef.value) dockObserver.observe(dockRef.value);
});

onBeforeUnmount(() => {
  dockObserver?.disconnect();
  dockObserver = null;
});

/* Both `[variant]` effects: the cached metrics are dropped
 * and the dock height is republished. Variant is fixed per instance. */
watch(
  () => props.variant,
  () => {
    textareaMetrics = null;
    appliedHeight = null;
    appliedOverflow = null;
    publishDockHeight();
  },
);
</script>

<template>
  <div
    ref="dockRef"
    class="composer-dock"
    :class="{
      'composer-dock-home': isHomeVariant,
      'composer-dock-docked': !isHomeVariant,
    }"
    :data-composer-dock="variant"
  >
    <div class="composer-stack">
      <PlanApprovalBar v-if="pendingProposal" :proposal="pendingProposal" />
      <AskToolCard v-if="pendingAsk" :request="pendingAsk" :queued="queuedAsks" />
      <div v-if="nativeReadOnly" class="composer-status" role="status">
        Native Pi session is read-only:
        {{ activeSessionSummary?.readOnlyReason ?? "continuation unavailable" }}.
      </div>
      <ComposerStatus
        :queued-prompts="queuedPrompts"
        :approval-pending="approvalPending"
        :enhancement-error="enhancementError"
        :dropped-directories="droppedDirectories"
        @remove-queued-prompt="removeQueuedPrompt"
        @move-queued-prompt="moveQueuedPrompt"
        @edit-queued-prompt="handleEditQueuedPrompt"
        @send-queued-now="sendQueuedNow"
        @clear-enhancement-error="clearEnhancementError"
        @open-dropped-folder-as-project="openDroppedFolderAsProject"
        @insert-dropped-directory-paths="insertDroppedDirectoryPaths"
        @dismiss-dropped-directories="dismissDroppedDirectories"
      />
      <ComposerImageAttachments
        :controller="draft.imagePreview"
        :disabled="inputBlocked"
        @remove="draft.removeImage"
      />
      <div
        ref="composerShellRef"
        class="composer-shell"
        :class="{ 'is-gated': inputBlocked, 'is-drop-target': dropTargetActive }"
        @dragenter="onComposerDragEnter"
        @dragover="onComposerDragOver"
        @dragleave="onComposerDragLeave"
        @drop="onComposerDrop"
      >
        <ComposerAutocomplete
          v-if="inputFocused"
          :anchor-ref="composerShellRef"
          :ac="composerAc"
          @accept="acceptCompletion"
        />
        <ComposerInput
          :image-preview="draft.imagePreview"
          :input-ref="draft.ref"
          :value="draftValue"
          :placeholder-text="placeholderText"
          :placeholder-key="placeholderRenderKey"
          :input-blocked="inputBlocked"
          :pasting="pasting"
          :enter-to-send="enterToSend"
          :run-active="runActive"
          :composer-ac="composerAc"
          @paste="pasteClipboardFiles"
          @accept-completion="acceptCompletion"
          @submit="onComposerInputSubmit"
          @insert-newline="draft.insertNewlineInEditor"
          @input="draft.handleInput"
          @composition-start="draft.setComposing(true)"
          @composition-end="onCompositionEnd"
          @focus="draft.setInputFocused(true)"
          @blur="onInputBlur"
        />
        <ComposerToolbar
          :mode="mode"
          :planning-live="planningLive"
          :provider-id="provider?.id"
          :model-id="modelId"
          :thinking-level="thinkingLevel"
          :composer-permission-mode="composerPermissionMode"
          :permission-open="permissionOpen"
          :set-permission-open="setPermissionOpen"
          :controls-blocked="controlsBlocked"
          :pasting="pasting"
          :pick-and-attach="pickAndAttach"
          :configure-active-session="configureActiveSession"
          :show-toast="showToast"
          :model-menu="modelMenu"
          :model-label="modelLabel"
          :thinking-label="thinkingLabel"
          :context-usage="composerContextUsage ?? null"
          :enhancement-draft="enhancementDraft"
          :value="draftValue"
          :model-ready="modelReady"
          :send-blocked="sendBlocked"
          :enhancing-prompt="enhancingPrompt"
          :enhancement-undo-text="enhancementUndoText"
          :enhance-prompt="enhancePrompt"
          :undo-prompt-enhancement="undoPromptEnhancement"
          :clear-enhancement-error="clearEnhancementError"
          :run-active="runActive"
          :has-draft-content="hasDraftContent"
          :abort="abort"
          :submit="submit"
        />
      </div>
    </div>
  </div>
</template>
