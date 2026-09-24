<script setup lang="ts">
/**
 * The transcript scroller: the retained reading surface of one session.
 *
 * The `ChatTranscript` component. The two contexts it wraps around its root
 * become the `provide` calls below, so the template's root is the single
 * `div.thread-wrap` element.
 *
 * The implementation decisions that are not mechanical:
 *
 *  1. **The paging callbacks stay function props, not emits.** Rule of thumb in
 *     this tree is that an `onXxx` prop becomes a `vue` emit, and
 *     `ConversationMinimap`/`ToolRow` do exactly that. These two cannot: the
 *     scroller calls `onLoadOlder()` and chains `.finally(...)` on the result
 *     (`hooks/useTranscriptScroll.ts:346`), and an emitted event handler
 *     returns `void`, so the chain would throw. They are read through wrappers
 *     that sample *presence* once (the `!onLoadOlder` gate, which
 *     decides at setup whether paging exists) but call the *current* prop, so a
 *     caller that rebinds the closure later is still honoured.
 *     `onReturnToLatest` is a plain click handler, so it is read directly.
 *  2. **`useTranscriptScroll` is called once with getters.** The composable's
 *     options are `MaybeRefOrGetter`, because it runs at setup rather than on every render.
 *     hook re-ran on every render. Every prop it reads is therefore passed as
 *     `() => props.x`, which is the same "read the value now" contract without
 *     freezing the first render's props.
 *  3. **The two contexts are `provide` calls.** `TranscriptSearchContext`
 *     carried the raw `searchTarget`; the pair provides a `Ref`, so a
 *     `computed` over the prop stands in — same snapshot-per-read semantics.
 *     `DisclosureAnchorContext` becomes `provideDisclosureAnchorNotifier` with
 *     the notifier the scroller returns.
 *  4. **`aria-hidden={!loadingOlder}` stays a bound boolean.** A bound boolean renders
 *     `aria-hidden="true"` / `"false"`; Vue writes the same two strings for a
 *     non-boolean `aria-*` attribute, so the attribute is not dropped when the
 *     row is visible.
 *  5. **The skeleton row's role class is a separate binding.**
 *     `` `transcript-skeleton-row ${row.role}` `` is `class` plus `:class` here:
 *     the class-name contract reads a template literal's static text verbatim,
 *     and the two roles are the only dynamic part.
 *  6. The store is read as `store.appState?.…`.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AgentActivity, PlanningState, UiMessage } from "@dcode/shared";
import { proposalKindForMode } from "@dcode/shared";
import { IconArrowDown } from "../../../lib/icons";
import { conversationPlainText } from "../../../lib/chat-transcript-text";
import {
  provideTranscriptMenu,
  useChatTextActions,
} from "../../../lib/transcript-menu-context";
import { useContextMenu } from "../../../lib/context-menu-state";
import ContextMenu from "../../../components/ContextMenu.vue";
import { conversationMenuItems } from "./menu-items";
import type { PendingPermission } from "../../../lib/pending-permissions";
import type { TranscriptSearchTarget } from "../../../lib/transcript-reading";
import { provideTranscriptSearch } from "../../../lib/transcript-search-context";
import { provideDisclosureAnchorNotifier } from "../../../lib/disclosure-anchor-context";
import { TRANSCRIPT_SKELETON_ROWS } from "../../../lib/transcript-settle";
import { useAppStore } from "../../../stores/app-store";
import ConversationMinimap from "../../../components/ConversationMinimap.vue";
import PermissionCard from "../../../components/PermissionCard.vue";
import TooltipButton from "../../../components/TooltipButton.vue";
import TurnOutcomeCard from "../../../components/TurnOutcomeCard.vue";
import PlanningIndicator from "./PlanningIndicator.vue";
import RunActivityIndicator from "./RunActivityIndicator.vue";
import WorkingIndicator from "./WorkingIndicator.vue";
import TranscriptHistory from "./TranscriptHistory.vue";
import TranscriptTail from "./TranscriptTail.vue";
import AgentStatusCapsule from "../../../components/AgentStatusCapsule.vue";
import { isDelegationStartTool } from "../../../lib/tool-display";
import { useTranscriptScroll } from "./hooks/useTranscriptScroll";

const props = withDefaults(
  defineProps<{
    sessionId: string | undefined;
    messages: UiMessage[];
    hasMoreBefore?: boolean;
    onLoadOlder?: () => Promise<void>;
    isRunning: boolean;
    pendingPermission?: PendingPermission;
    /** Requests waiting behind this one, from other delegates (ADR 0062). */
    queuedPermissions?: number;
    askPending?: boolean;
    planningState?: PlanningState;
    /**
     * Whether this instance's retained pane is the one on screen (ADR 0137). A
     * hidden pane keeps its DOM and scroll offset but must not chase the stream
     * or re-anchor, because its scroller has no visible viewport to correct.
     */
    paneVisible?: boolean;
    searchTarget?: TranscriptSearchTarget | null;
    readingWindow?: boolean;
    hasMoreAfter?: boolean;
    onLoadNewer?: () => Promise<void>;
    onReturnToLatest?: () => void;
    navigationLoading?: boolean;
  }>(),
  {
    hasMoreBefore: false,
    onLoadOlder: undefined,
    pendingPermission: undefined,
    queuedPermissions: 0,
    askPending: false,
    planningState: undefined,
    paneVisible: true,
    searchTarget: null,
    readingWindow: false,
    hasMoreAfter: false,
    onLoadNewer: undefined,
    onReturnToLatest: undefined,
    navigationLoading: false,
  },
);

const { t } = useI18n();
const store = useAppStore();

const transcriptRunning = computed(
  () => props.isRunning && !props.readingWindow,
);
const latestTurnResult = computed(() =>
  props.sessionId ? store.appState?.latestTurnResults[props.sessionId] : undefined,
);
const approvalPending = computed(() =>
  Boolean(
    props.sessionId &&
      store.appState?.pendingPlans[props.sessionId]?.status === "pending",
  ),
);
// Plan and Goal both project `planning`; the durable mode names which contract
// is being written, so the indicator can use that kind's copy.
const planningKind = computed(
  () =>
    proposalKindForMode(
      store.appState?.sessions.find((session) => session.id === props.sessionId)
        ?.mode ?? "agent",
    ) ?? "plan",
);
const turnSubagentsRunning = computed(() => {
  if (!props.isRunning) return false;
  const msgs = props.messages;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg.role === "user") break;
    if (msg.role === "tool") {
      const bare = (msg.toolName || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (bare.endsWith("taskwait") && msg.toolStatus === "running") {
        return true;
      }
      if (isDelegationStartTool(msg.toolName) && msg.toolStatus === "running") {
        return true;
      }
    }
  }
  return false;
});

const subagentsActive = computed(() => {
  if (turnSubagentsRunning.value) return true;
  const activity = props.sessionId
    ? store.appState?.agentStatuses[props.sessionId]?.activity
    : undefined;
  if (activity?.phase === "waiting-subagents") return true;

  const msgs = props.messages;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg.role === "user") break;
    if (msg.role === "tool" && isDelegationStartTool(msg.toolName)) {
      if (msg.toolStatus === "running") return true;
    }
  }
  return false;
});

const agentActivity = computed<AgentActivity | undefined>(() => {
  const activity = props.sessionId
    ? store.appState?.agentStatuses[props.sessionId]?.activity
    : undefined;
  // Global status is centered on the main window.
  // Only when the main window actively waits for subagents (phase === "waiting-subagents"),
  // does the global status display "等待智能体执行".
  // When any subagent finishes and reports back to the main window, the runtime exits
  // delegation wait and resumes the main window, so the global status immediately reflects
  // the main window's active state (waiting-model, running, etc.).
  return activity;
});
const compactions = computed(() =>
  props.sessionId ? store.appState?.sessionCompactions[props.sessionId] : undefined,
);

/**
 * See note 1: presence is sampled once, the call is always the current prop.
 */
const loadOlderPage = props.onLoadOlder
  ? () => props.onLoadOlder?.() ?? Promise.resolve()
  : undefined;
const loadNewerPage = props.onLoadNewer
  ? () => props.onLoadNewer?.() ?? Promise.resolve()
  : undefined;

const {
  scrollRef,
  wrapRef,
  contentRef,
  historyBoundaryRef,
  loadingOlder,
  showJump,
  historyEntries,
  tailEntry,
  minimapMessages,
  hasEarlierHistory,
  hydrationBounded,
  veilCovering,
  veilPhase,
  handleScroll,
  revealEarlierHistory,
  jumpToLatest,
  disclosureAnchorNotifier,
} = useTranscriptScroll({
  sessionId: () => props.sessionId,
  messages: () => props.messages,
  compactions: () => compactions.value,
  hasMoreBefore: () => props.hasMoreBefore,
  onLoadOlder: loadOlderPage,
  isRunning: transcriptRunning,
  pendingPermission: () => props.pendingPermission,
  askPending: () => props.askPending,
  approvalPending: () => approvalPending.value,
  planningState: () => props.planningState,
  paneVisible: () => props.paneVisible,
  searchTarget: () => props.searchTarget,
  readingWindow: () => props.readingWindow,
});

provideTranscriptSearch(computed(() => props.searchTarget));
provideDisclosureAnchorNotifier(disclosureAnchorNotifier);


/*
  The background menu answers the right-clicks no row claimed: the space below
  the last turn, a system row, a permission or outcome card. It reads the
  conversation rather than one message, so it is the only surface that can
  copy the whole thread.
*/
const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();
provideTranscriptMenu(openContextMenu);
const { copyText, selectText } = useChatTextActions();

function onContextMenu(event: MouseEvent): void {
  openContextMenu(event, {
    label: t("chat.conversationMenu"),
    items: conversationMenuItems({
      t,
      conversation: conversationPlainText(props.messages, {
        user: t("chat.speakerYou"),
        assistant: t("chat.speakerAssistant"),
      }),
      scrollRef,
      contentRef,
      actions: { copyText, selectText },
      onReturnToLatest: returnToLatest,
    }),
  });
}
/**
 * The minimap measures its own DOM positions, so it takes a getter rather than
 * the element: `ConversationMinimap` re-measures when the getter's reads
 * change, and a bare `:scroll-ref` binding would hand it the first render's
 * `null` with nothing to invalidate.
 */
const transcriptScroller = () => scrollRef.value;

const specializedActivity = computed(() => agentActivity.value);
const hasSpecializedActivity = computed(
  () => specializedActivity.value !== undefined,
);
// Existing output does not mean the turn has finished: a text stream can
// pause, and completed tool rows can outlive their activity. Keep one tail
// status until the turn ends or a user interaction owns the pending state.
const showStatus = computed(
  () =>
    transcriptRunning.value &&
    !props.pendingPermission &&
    !props.askPending &&
    !approvalPending.value,
);
const showRunActivity = computed(
  () => showStatus.value && hasSpecializedActivity.value,
);
const showWorking = computed(
  () =>
    showStatus.value &&
    props.planningState !== "planning" &&
    !hasSpecializedActivity.value,
);
const showPlanning = computed(
  () =>
    showStatus.value &&
    props.planningState === "planning" &&
    !hasSpecializedActivity.value,
);

// The tail status lane is part of the layout for the whole running turn: the
// indicators below mount and clear with the turn's phase, and a lane that came
// and went with them would resize `.thread-content` and push the rows the user
// is already reading (issue #323). An idle transcript renders no lane at all,
// so a finished transcript keeps its exact layout.
const runtimeStatusLane = computed(() => transcriptRunning.value);

function returnToLatest(): void {
  props.onReturnToLatest?.();
  jumpToLatest();
}
</script>

<template>
  <div
    ref="wrapRef"
    class="thread-wrap"
    :data-transcript-settling="veilCovering ? 'true' : undefined"
  >
    <!-- The minimap measures row positions against a rendered scroller. A
      * hidden pane has none, so measuring there would cache junk offsets and
      * reuse them on reveal. It is out of flow and re-measures on mount, so
      * leaving it out while hidden costs nothing. It also waits for the settle
      * veil to lift: mounting it against still-moving rows would cache offsets
      * the settled layout no longer matches. -->
    <ConversationMinimap
      v-if="props.paneVisible && !veilCovering"
      :scroll-ref="transcriptScroller"
      :messages="minimapMessages"
      :has-earlier="hasEarlierHistory"
      :loading-earlier="loadingOlder"
      @reveal-earlier="revealEarlierHistory"
    />
    <div
      ref="scrollRef"
      class="thread-scroll"
      data-scroll-owner="transcript"
      role="log"
      aria-live="polite"
      @scroll="handleScroll"
      @contextmenu="onContextMenu"
    >
      <div ref="contentRef" class="thread-content">
        <div
          ref="historyBoundaryRef"
          class="transcript-history-loading"
          role="status"
          aria-live="polite"
          :aria-hidden="!loadingOlder"
        >
          {{ loadingOlder ? t("chat.loadingEarlierMessages") : "" }}
        </div>
        <!-- One viewport of slack, not a per-entry estimate. The spacer exists
          * so the bounded commit can still scroll to its bottom; sizing it from
          * a guessed row height made the expansion correct that guess in view,
          * which is exactly the jitter this avoids. -->
        <div v-if="hydrationBounded" class="transcript-hydration-spacer" aria-hidden="true" />
        <TranscriptHistory :entries="historyEntries" :is-running="props.isRunning" />
        <TranscriptTail
          v-if="tailEntry"
          :entry="tailEntry"
          :is-running="props.isRunning"
          :is-active="transcriptRunning && tailEntry.kind === 'assistant-turn'"
          :runtime-activity="specializedActivity"
        />
        <button
          v-if="props.hasMoreAfter"
          type="button"
          class="transcript-load-later"
          :disabled="props.navigationLoading"
          @click="void loadNewerPage?.()"
        >
          {{ t("chat.loadLaterMessages") }}
        </button>
        <TurnOutcomeCard
          v-if="!props.readingWindow"
          :messages="props.messages"
          :result="latestTurnResult"
        />
        <PermissionCard
          v-if="props.pendingPermission"
          :key="props.pendingPermission.requestId"
          :permission="props.pendingPermission"
          :queued="props.queuedPermissions"
        />
        <div v-if="runtimeStatusLane" class="transcript-runtime-status">
          <RunActivityIndicator
            v-if="showRunActivity && specializedActivity"
            :activity="specializedActivity"
          />
          <PlanningIndicator v-if="showPlanning" :kind="planningKind" />
          <WorkingIndicator v-if="showWorking" />
        </div>
      </div>
    </div>
    <!-- Positioned without a z-index on purpose: it paints above the scroller
      * in tree order and stays beneath the docked composer, so the user can
      * keep typing while the transcript settles. -->
    <div
      v-if="veilPhase !== 'off'"
      class="transcript-settle-veil"
      :data-phase="veilPhase"
      role="status"
      :aria-busy="veilCovering"
      :aria-label="t('chat.loadingSession')"
    >
      <div class="transcript-settle-veil-band">
        <div
          v-for="(row, rowIndex) in TRANSCRIPT_SKELETON_ROWS"
          :key="rowIndex"
          class="transcript-skeleton-row"
          :class="row.role"
          aria-hidden="true"
        >
          <span
            v-for="(width, lineIndex) in row.lines"
            :key="lineIndex"
            class="transcript-skeleton-line"
            :style="{ width }"
          />
        </div>
      </div>
    </div>
    <div
      v-if="props.navigationLoading"
      class="transcript-navigation-loading"
      role="status"
    >
      {{ t("chat.loadingSession") }}
    </div>
    <TooltipButton
      v-if="(showJump || props.readingWindow) && !veilCovering"
      class="jump-latest-btn"
      :aria-label="t('chat.scrollToBottom')"
      :label="t('chat.scrollToBottom')"
      @click="returnToLatest"
    >
      <IconArrowDown :size="14" />
    </TooltipButton>

    <AgentStatusCapsule
      v-if="props.paneVisible"
      :session-id="props.sessionId"
      :messages="props.messages"
      :is-running="props.isRunning"
      :is-browsing-history="Boolean(showJump || props.readingWindow)"
    />
  </div>
    <ContextMenu :state="contextMenu" @close="closeContextMenu" />
</template>
