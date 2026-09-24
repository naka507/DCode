<script setup lang="ts">
/**
 * Subagent dock — the selected delegate's detail, with the reading view the
 * main transcript uses (follow scroll, search focus, disclosure anchors).
 *
 * The `SubagentPanel` component. The reading-view wiring
 * is the shared pair `hooks/use-follow-scroll.ts` +
 * `hooks/use-transcript-search-focus.ts`, and `useTranscriptView` supplies the
 * same range the transcript reads.
 *
 * The decisions that are not mechanical:
 *
 *  1. **`SubagentDetail` comes from the transcript cluster.**
 * `src/renderer/features/chat/transcript/SubagentDetail.vue`; it is imported
 *     from the transcript module.
 *  2. **`DisclosureAnchorContext.Provider` is `provideDisclosureAnchorNotifier`,**
 * called once in setup. Only the `<section>` is wrapped; the provider's
 *     scope is its own template and everything below it.
 *  3. **`useMemo` becomes `computed`, and `findSelectedSubagent` is a pure
 * module-level helper.** The memo keyed on `[messages, delegationId]`;
 *     the `computed` re-runs on the same two values.
 *  4. **`useLayoutEffect` is `onMounted` plus a post-flush `watch`.** Both
 * earlier effects ran before paint and read DOM the same render had
 *     produced, so the watchers are `flush: "post"` and the first application
 *     is covered by `onMounted`, which is the shape
 *     `features/chat/transcript/SubagentRunRows.vue` already uses for the
 *     nested follow scroller.
 *  5. **The store read of `runningSessions` is a `computed` over
 *     `store.appState`**, since `appState` is a `shallowRef`.
 */
import { computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { UiMessage } from "@dcode/shared";
import {
  buildTranscriptEntries,
  type AssistantActivityItem,
} from "../../lib/assistant-turns";
import {
  collectDelegationFailures,
  collectDelegationStatuses,
  collectDelegationTimings,
  isDelegationActivityItem,
  type DelegationActivityItem,
  type DelegationFailure,
  type SubagentOutcome,
  type SubagentTiming,
} from "../../lib/subagent-topology";
import {
  delegationIdForMessage,
  type SubagentPanelSelection,
} from "../../lib/subagent-panel";
import { provideDisclosureAnchorNotifier } from "../../lib/disclosure-anchor-context";
import { IconArrowDown } from "../../lib/icons";
import { useFollowScroll } from "../../hooks/use-follow-scroll";
import { useTranscriptView } from "../../hooks/use-transcript-view";
import { useTranscriptSearchFocus } from "../../hooks/use-transcript-search-focus";
import { useAppStore } from "../../stores/app-store";
import TooltipButton from "../TooltipButton.vue";
import SubagentDetail from "../../features/chat/transcript/SubagentDetail.vue";

type SelectedSubagent = {
  item: DelegationActivityItem;
  turnActivityItems: AssistantActivityItem[];
};

function findSelectedSubagent(
  messages: UiMessage[],
  delegationId: string,
): SelectedSubagent | null {
  const { entries } = buildTranscriptEntries(messages);
  for (const entry of entries) {
    if (entry.kind !== "assistant-turn") continue;
    const turnActivityItems = entry.parts.flatMap((part) =>
      part.kind === "activity" ? part.items : [],
    );
    const item = turnActivityItems.find(
      (candidate): candidate is DelegationActivityItem =>
        isDelegationActivityItem(candidate) &&
        delegationIdForMessage(candidate.message) === delegationId,
    );
    if (item) return { item, turnActivityItems };
  }
  return null;
}

const props = defineProps<{ selection: SubagentPanelSelection }>();

const { t } = useI18n();
const store = useAppStore();

const activeSessionId = computed(() => store.appState?.activeSessionId);
const transcript = useTranscriptView(() => props.selection.sessionId);
const messages = transcript.messages;
const searchTarget = computed(() =>
  props.selection.searchRequestId === transcript.focus.value?.requestId
    ? transcript.focus.value
    : null,
);
const isRunning = computed(
  () => store.appState?.runningSessions[props.selection.sessionId] ?? false,
);
const selected = computed(() =>
  findSelectedSubagent(messages.value, props.selection.delegationId),
);
const delegationStatuses = computed<ReadonlyMap<string, SubagentOutcome>>(() =>
  selected.value
    ? collectDelegationStatuses(selected.value.turnActivityItems, {
        turnLive: isRunning.value,
      })
    : new Map(),
);
const delegationFailures = computed<ReadonlyMap<string, DelegationFailure>>(() =>
  selected.value
    ? collectDelegationFailures(selected.value.turnActivityItems)
    : new Map(),
);
const delegationTimings = computed<ReadonlyMap<string, SubagentTiming>>(() =>
  selected.value
    ? collectDelegationTimings(selected.value.turnActivityItems)
    : new Map(),
);

const {
  scrollRef,
  contentRef,
  showJump,
  handleScroll,
  jumpToLatest,
  scheduleFollowScroll,
  releaseFollow,
  disclosureAnchorNotifier,
} = useFollowScroll();

provideDisclosureAnchorNotifier(disclosureAnchorNotifier);

const searchSource = computed(
  () =>
    messages.value.find((message) => message.id === searchTarget.value?.messageId)
      ?.content ?? "",
);

/** A fresh selection with no search request starts at the bottom of the dock. */
onMounted(() => {
  if (!searchTarget.value) jumpToLatest();
});
watch(
  [() => props.selection.delegationId, searchTarget],
  () => {
    if (!searchTarget.value) jumpToLatest();
  },
  { flush: "post" },
);

watch(messages, () => scheduleFollowScroll(), { flush: "post" });

useTranscriptSearchFocus({
  target: searchTarget,
  source: searchSource,
  scrollRef,
  contentRef,
  contentVersion: messages,
  onNavigate: releaseFollow,
});
</script>

<template>
  <section
    id="subagent-panel"
    class="subagent-panel"
    role="complementary"
    aria-labelledby="subagent-panel-title"
    data-testid="subagent-panel"
  >
    <div
      ref="scrollRef"
      data-scroll-owner="follow"
      class="subagent-panel-scroll"
      role="log"
      aria-live="polite"
      :tabindex="0"
      @scroll="handleScroll"
    >
      <div ref="contentRef">
        <SubagentDetail
          v-if="selected"
          :message="selected.item.message"
          :delegate="selected.item.delegate"
          :delegation-statuses="delegationStatuses"
          :delegation-failures="delegationFailures"
          :delegation-timings="delegationTimings"
        />
        <div v-else class="subagent-panel-empty" role="status">
          {{ t("panel.subagentEmpty") }}
        </div>
      </div>
    </div>
    <TooltipButton
      v-if="showJump"
      type="button"
      class="jump-latest-btn subagent-panel-jump"
      :label="t('chat.scrollToBottom')"
      :aria-label="t('chat.scrollToBottom')"
      @click="jumpToLatest"
    >
      <IconArrowDown :size="14" />
    </TooltipButton>
    <span id="subagent-panel-title" class="sr-only">
      {{
        activeSessionId === selection.sessionId
          ? t("panel.subagent")
          : t("panel.subagentEmpty")
      }}
    </span>
  </section>
</template>
