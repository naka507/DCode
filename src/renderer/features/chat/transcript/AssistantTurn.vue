<script setup lang="ts">
/**
 * One assistant turn: the process disclosure (or its collapsed embedded form),
 * the answer fragments, the response metadata and the action bar.
 *
 * The `AssistantTurn` module, which exports six names from one module.
 * which exported six names from one module. This SFC is the `AssistantTurn`
 * component; the plain `<script>` block at the bottom is the module surface that
 * still answers to every original name, so a call site only changes its import
 * path — `ChatTranscript.vue` imports `{ TranscriptHistory, TranscriptTail }`
 * and the module also carries `TranscriptEntryView`, `CompactionRow`,
 * `compactionMarksEqual` and `transcriptEntryEqual`.
 *
 * The decisions that are not mechanical:
 *
 *  1. **the `renderPart` closure is the local `TurnPartView`.** The
 *     original called one closure from three places — the `TurnProcess`
 *     children, the responses after it, and (detailed mode) every part of the
 *     turn in place — and a template has no reusable fragment to call, so the
 *     part markup is one `defineComponent` render function here rather than the
 *     same block written out repeatedly. It renders no element of its own, so
 *     the DOM is unchanged. `ActivityGroupRows.vue` is the same move made
 *     with a file; this one stays local because it is a closure over this
 *     component's state, not a component in its own right.
 *  1b. **The two branches are a `<template v-if>` pair, not one fragment.**
 *     `groupProcess` decides between the Compact disclosure (process children
 *     plus responses) and Detailed's flat `entry.parts` render; the fragment
 *     renders no element, so the `.message-col` child list is unchanged.
 *  2. **`memo` and `assistantTurnPropsEqual` are gone from the component.** The
 *     comparator lives in the module to feed `memo`; a Vue component
 *     re-renders only when a value its render reads changes. The comparator is
 *     still in `./AssistantTurn.ts` because `transcriptEntryEqual` is built on
 *     it and that helper is part of this module's surface.
 *  3. **`useMemo` is a `computed`.** The delegation maps are the one place
 *     where a `computed` alone is not enough: the previous maps are kept
 *     in refs and reused them through `reuseReadonlyMap`, because an
 *     identity-stable map is what let the memoized `ActivityGroup` bail out.
 *     Vue compares a child's props by identity before re-rendering it, so the
 *     same reuse buys the same bail-out here, and the previous values are
 *     plain bindings rather than refs because nothing renders them.
 *  4. **The store's action selectors become `store.appState?.<action>`.**
 *     The store's action selectors read `retryAssistantMessage` / `forkAssistantMessage` through
 *     `useAppStore((s) => s.…)`; `appState` is the store's `shallowRef`
 *     and carries the composed action surface.
 *  5. **`aria-hidden` never appears bare here**, so nothing needed the explicit
 *     `="true"` rewrite; the message fragments carry no ARIA attributes at all
 *     here either.
 *  6. `t(key, "Fallback")` becomes `t(key)`: every key ships in the catalogs.
 */
import { computed, defineComponent, h, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import type { AgentActivity, UiMessage } from "@dcode/shared";
import {
  assistantTurnContent,
  assistantTurnMessages,
  assistantTurnResponseDuration,
  assistantTurnResponseOutputTokens,
  assistantTurnUsage,
  reuseReadonlyMap,
  type AssistantTurnEntry,
  type AssistantTurnPart,
} from "../../../lib/assistant-turns";
import {
  collectDelegationStatuses,
  collectDelegationTimings,
  type SubagentOutcome,
  type SubagentTiming,
} from "../../../lib/subagent-topology";
import {
  isLastActivityPart,
  projectTurnProcess,
  resolveThinkingDisplayMode,
  shouldGroupTurnProcess,
} from "../../../lib/turn-process";
import { useAppStore } from "../../../stores/app-store";
import { IconBranch, IconReview } from "../../../lib/icons";
import Markdown from "../../../components/Markdown.vue";
import TooltipButton from "../../../components/TooltipButton.vue";
import ActivityGroup from "./ActivityGroup.vue";
import TurnProcess from "./TurnProcess.vue";
import AssistantErrorMessage from "./AssistantErrorMessage.vue";
import CopyButton from "./CopyButton.vue";
import { assistantTurnMenuItems } from "./menu-items";
import {
  useChatTextActions,
  useTranscriptMenu,
} from "../../../lib/transcript-menu-context";
import MessageMeta from "./MessageMeta.vue";

const props = defineProps<{
  entry: AssistantTurnEntry;
  isActive: boolean;
  runtimeActivity?: AgentActivity;
}>();

const { t } = useI18n();
const store = useAppStore();

const openTranscriptMenu = useTranscriptMenu();
const { copyText, selectText } = useChatTextActions();
const messages = computed(() => assistantTurnMessages(props.entry));
const content = computed(() => assistantTurnContent(props.entry));
/** The last fragment that actually said something; the turn's actions target it. */
const actionMessage = computed(() =>
  [...messages.value]
    .reverse()
    .find((message) => (message.content || "").trim()),
);
const metaMessage = computed(() =>
  [...messages.value]
    .reverse()
    .find(
      (message) =>
        message.modelId ||
        message.usage ||
        message.responseDurationMs ||
        message.responseOutputTokens,
    ),
);
const latestUsageMessage = computed(() =>
  [...messages.value].reverse().find((message) => message.usage),
);
const usage = computed(() => assistantTurnUsage(props.entry));
const responseDurationMs = computed(() => assistantTurnResponseDuration(props.entry));
const responseOutputTokens = computed(() =>
  assistantTurnResponseOutputTokens(props.entry),
);
const modelId = computed(
  () => metaMessage.value?.modelId ?? latestUsageMessage.value?.modelId,
);
const hasError = computed(() =>
  messages.value.some((message) => Boolean(message.error)),
);
const complete = computed(
  () =>
    !props.isActive &&
    !hasError.value &&
    Boolean(content.value) &&
    Boolean(actionMessage.value),
);
const streaming = computed(
  () =>
    props.isActive &&
    messages.value.some((message) => message.status === "streaming"),
);
/*
  The turn owns the menu for its whole subtree, the answer rows it renders
  included: Regenerate and Branch act on the turn's answer message, so a menu
  owned by a single message part could not offer them honestly.
*/
function onContextMenu(event: MouseEvent): void {
  const target = event.currentTarget;
  const bubbles =
    target instanceof HTMLElement
      ? target.querySelectorAll<HTMLElement>(".message-bubble")
      : null;
  openTranscriptMenu(event, {
    label: t("chat.messageMenu"),
    items: assistantTurnMenuItems({
      t,
      answer: content.value,
      selectTarget: bubbles?.length ? bubbles[bubbles.length - 1] : null,
      complete: complete.value && Boolean(actionMessage.value),
      actions: { copyText, selectText },
      onRegenerate: () => {
        if (actionMessage.value) void store.appState?.retryAssistantMessage(actionMessage.value.id);
      },
      onBranch: () => {
        if (actionMessage.value) void store.appState?.forkAssistantMessage(actionMessage.value.id);
      },
    }),
  });
}

// Collect delegation statuses across ALL activity parts of this turn so that a
// TaskWait in one part can inform the Task cards in a different part.
const turnAllActivityItems = computed(() =>
  props.entry.parts.flatMap((part) => (part.kind === "activity" ? part.items : [])),
);
/**
 * The `statusesRef` / `timingsRef` pair. The previous map is kept so an
 * unchanged one keeps its identity — see note 3 in this file's header.
 */
let previousStatuses: ReadonlyMap<string, SubagentOutcome> | undefined;
let previousTimings: ReadonlyMap<string, SubagentTiming> | undefined;
const turnDelegationStatuses = computed(() => {
  previousStatuses = reuseReadonlyMap(
    previousStatuses,
    collectDelegationStatuses(turnAllActivityItems.value, {
      turnLive: props.isActive,
    }),
  );
  return previousStatuses;
});
const turnDelegationTimings = computed(() => {
  previousTimings = reuseReadonlyMap(
    previousTimings,
    collectDelegationTimings(turnAllActivityItems.value),
    (left, right) =>
      left.startedAt === right.startedAt && left.completedAt === right.completedAt,
  );
  return previousTimings;
});

const process = computed(() => projectTurnProcess(props.entry).process);
const responses = computed(() => projectTurnProcess(props.entry).responses);
/**
 * Detailed renders every part in place with no process wrapper; only Compact
 * folds thinking, tools and intermediate text into one disclosure.
 */
const groupProcess = computed(() =>
  shouldGroupTurnProcess(
    resolveThinkingDisplayMode(store.appState?.settings?.thinkingDisplayMode),
  ),
);
/** Only the live turn's last part owns the runtime phase. */
const activePart = computed(() =>
  props.isActive ? props.entry.parts.at(-1) : undefined,
);

/**
 * The `v-for` keys, extracted so the two `renderPart` call sites and the
 * template agree: an activity part is keyed by its first item's message, a
 * message part by its own id (the two `key` expressions).
 */
function partKey(part: AssistantTurnPart): string {
  return part.kind === "activity"
    ? `activity-${part.items[0].message.id}`
    : part.message.id;
}

/** The part renderer, unchanged apart from its Vue element syntax. */
function renderPart(part: AssistantTurnPart) {
  if (part.kind === "activity") {
    return h(ActivityGroup, {
      // The `v-for` that renders this owns the element key; the element key
      // here is the same string, so nothing moves.
      embedded: true,
      items: part.items,
      endedAt: part.endedAt,
      isActive: part === activePart.value,
      isLast: isLastActivityPart(props.entry.parts, part),
      runtimeActivity: part === activePart.value ? props.runtimeActivity : undefined,
      turnDelegationStatuses: turnDelegationStatuses.value,
      turnDelegationTimings: turnDelegationTimings.value,
    });
  }
  return h(
    "div",
    {
      // Same key note as the activity branch above.
      class: {
        "message-bubble": true,
        "assistant-turn-fragment": true,
        streaming: props.isActive && part.message.status === "streaming",
      },
      "data-message-id": part.message.id,
    },
    [
      part.message.content
        ? h("div", { class: "prose-chat" }, [
            h(Markdown, {
              source: part.message.content,
            }),
          ])
        : null,
      part.message.error
        ? h(AssistantErrorMessage, { message: part.message })
        : null,
    ],
  );
}

/** One rendered part; renders no element of its own. See note 1. */
const TurnPartView = defineComponent({
  name: "AssistantTurnPart",
  props: {
    part: { type: Object as PropType<AssistantTurnPart>, required: true },
  },
  setup(partProps) {
    return () => renderPart(partProps.part);
  },
});

function forkResponse(message: UiMessage): void {
  void store.appState?.forkAssistantMessage(message.id);
}

function retryResponse(message: UiMessage): void {
  void store.appState?.retryAssistantMessage(message.id);
}
</script>

<script lang="ts">
/**
 * This module exports six names. `<script setup>` cannot export, so the
 * four names that are not this component are re-exported here from their own
 * files and the component re-exports its own default, exactly the shape
 * `ToolRow.vue` and `SubagentDetail.vue` use. Every consumer keeps the same
 * specifier (`./AssistantTurn` -> `./AssistantTurn.vue`).
 */
export { default as AssistantTurn } from "./AssistantTurn.vue";
export { default as CompactionRow } from "./CompactionRow.vue";
export { default as TranscriptEntryView } from "./TranscriptEntryView.vue";
export { default as TranscriptHistory } from "./TranscriptHistory.vue";
export { default as TranscriptTail } from "./TranscriptTail.vue";
export {
  compactionMarksEqual,
  transcriptEntryEqual,
  transcriptEntryKey,
} from "./AssistantTurn";
</script>

<template>
  <div
    class="message-row assistant assistant-turn"
    :class="{ streaming }"
    :data-minimap-id="props.entry.anchorId"
    data-row-role="assistant"
    @contextmenu="onContextMenu"
    role="article"
    :aria-label="t('chat.assistantMessage')"
  >
    <div class="message-col">
      <template v-if="groupProcess">
        <TurnProcess
          :process-parts="process"
          :turn-parts="props.entry.parts"
          :is-active="props.isActive"
        >
          <TurnPartView
            v-for="part in process"
            :key="partKey(part)"
            :part="part"
          />
        </TurnProcess>
        <TurnPartView
          v-for="part in responses"
          :key="partKey(part)"
          :part="part"
        />
      </template>
      <!-- Detailed mode keeps every part in place: no process disclosure, and
        * the parts are the same projection Compact would have wrapped. -->
      <template v-else>
        <TurnPartView
          v-for="part in props.entry.parts"
          :key="partKey(part)"
          :part="part"
        />
      </template>
      <MessageMeta
        v-if="!props.isActive && metaMessage"
        :model-id="modelId"
        :usage="usage"
        :response-duration-ms="responseDurationMs"
        :response-output-tokens="responseOutputTokens"
      />
      <!-- The action row only mounts when its controls exist: a running or
        * failed turn has no copy/fork/retry, and an empty toolbar would
        * reserve invisible space below the output. -->
      <div v-if="complete && actionMessage" class="message-actions">
        <CopyButton :text="content" :label="t('chat.copy')" />
        <TooltipButton
          class="copy-btn icon"
          :label="t('chat.forkResponse')"
          :aria-label="t('chat.forkResponse')"
          @click="forkResponse(actionMessage)"
        >
          <IconBranch :size="13" />
        </TooltipButton>
        <TooltipButton
          class="copy-btn icon"
          :label="t('chat.retry')"
          :aria-label="t('chat.retry')"
          @click="retryResponse(actionMessage)"
        >
          <IconReview :size="13" />
        </TooltipButton>
      </div>
    </div>
  </div>
</template>
