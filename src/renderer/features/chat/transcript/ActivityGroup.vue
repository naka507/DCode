<script setup lang="ts">
/**
 * One assistant turn's activity part: a disclosure whose header says what the
 * turn is doing (or how long it took) and whose body holds the rows themselves.
 *
 * This SFC is the `ActivityGroup` component and, through the plain `<script>`
 * block at the bottom, the module that also answers to its five sibling names —
 * `AssistantTurn.vue` imports
 * `{ activityItemsEqual, ActivityGroup }` and `ChatTranscript.vue` imports
 * `{ PlanningIndicator, RunActivityIndicator, WorkingIndicator }`, so a call site
 * only changes its import path.
 *
 * The decisions that are not mechanical:
 *
 *  1. **The two early returns are gated roots.** A template cannot return early,
 * so the `if (compact && onlyThinking && !thinkingNow) return null` is
 *     the `visible` gate and its `embedded && !hasSubagentTopology` branch is the
 *     first of two sibling roots inside a `<template>` fragment. The fragment
 * renders no element of its own, so the DOM is unchanged.
 * 2. **`renderActivityItems()` is `ActivityGroupRows`.** The closure was
 *     called from both roots, and an SFC has one template; the list lives in
 *     `./ActivityGroupRows.vue` and the projection (`renderActivityRows`) in
 *     `./activity-group.ts`, latch and keys unchanged.
 * 3. **The `[live]` effect is a watcher plus a mount call.** The effect latched
 *     `wasActiveRef`, stamped `finishedAt` when the group stopped being live and
 *     ticked a one-second clock while it was; `syncClock` is that body, called on
 *     mount and on every `live` change, with
 *     `onScopeDispose` taking over the `clearInterval`.
 *  4. **`useAppStore` is read as `store.appState?.…`.** `appState` is the store's
 *     `shallowRef`; `getState()` is not part of the store's surface.
 *  5. **`useContext(TranscriptSearchContext)` is `useTranscriptSearchTarget()`.**
 *     The provided pair gives a ref; the hook reads its value, which is the same
 * snapshot-per-render the hook would otherwise have.
 * 6. **The `phase-*` class is spelled out in the template.** Building it with a
 *     template literal would leave the class-name contract reading the glued
 *     fragment `phase-`, so `phaseKey` carries only the selection and the seven
 *     names are literal. None of the seven has a rule in
 *     `src/renderer/styles/*.css`, so they are inert in this tree; the phase
 *     surfaces through the `data-phase` attribute of the activity indicator
 *     (`.run-activity-indicator[data-phase="…"]`) and through the label text,
 *     not through these class names. `turn-process-activity`, the embedded root
 *     below, is *not* inert: `styles/messages.css` sizes it, because without a
 *     width it was laid out at max-content inside the flex-start assistant
 *     column and one long tool line widened the column past the row's clip.
 *  7. **`memo` and `activityGroupPropsEqual` are gone.** The comparator existed
 *     only to skip re-renders that a Vue component never does. `activityItemsEqual`
 *     stays exported because a consumer imports it.
 *  8. **`aria-hidden="true"` is explicit** wherever the markup writes it bare.
 *  9. `t(key, "Fallback")` becomes `t(key)`: every key ships in the catalogs.
 */
import { computed, onMounted, onScopeDispose, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AgentActivity } from "@dcode/shared";
import type { AssistantActivityItem } from "../../../lib/assistant-turns";
import {
  collectDelegationStatuses,
  collectDelegationTimings,
  delegationTimingBounds,
  isDelegationActivityItem,
  summarizeSubagentActivity,
  type DelegationActivityItem,
  type SubagentOutcome,
  type SubagentTiming,
} from "../../../lib/subagent-topology";
import { formatToolDuration } from "../../../lib/tool-display";
import { useTranscriptSearchTarget } from "../../../lib/transcript-search-context";
import { resolveThinkingDisplayMode } from "../../../lib/turn-process";
import { useAppStore } from "../../../stores/app-store";
import {
  IconChevronRight,
  IconSparkles,
  IconWorkflow,
} from "../../../lib/icons";
import {
  activityItemDetail,
  renderActivityRows,
  runActivityLabel,
  type Translate,
} from "./activity-group";
import { useAutomaticDisclosure } from "./shared";
import ActivityGroupRows from "./ActivityGroupRows.vue";
import DisclosureCollapseRail from "./DisclosureCollapseRail.vue";

const props = withDefaults(
  defineProps<{
    items: AssistantActivityItem[];
    embedded?: boolean;
    isActive: boolean;
    endedAt?: string;
    /** Last activity chunk of this assistant turn. */
    isLast?: boolean;
    /** Current runtime wait phase, when the group owns the live turn tail. */
    runtimeActivity?: AgentActivity;
    /** Delegation statuses from the entire assistant turn (cross-activity-part). */
    turnDelegationStatuses?: ReadonlyMap<string, SubagentOutcome>;
    /** Delegation timings from the entire assistant turn (cross-activity-part). */
    turnDelegationTimings?: ReadonlyMap<string, SubagentTiming>;
  }>(),
  { embedded: false, isLast: false },
);

const { t } = useI18n();
const store = useAppStore();
const detailsId = useId();

const compact = computed(
  () =>
    resolveThinkingDisplayMode(store.appState?.settings?.thinkingDisplayMode) ===
    "compact",
);
// One delegation reads the same as five: the card is how a delegation is
// presented, not a treatment reserved for fan-out. A lone `Task` rendered as an
// ordinary tool row hid the outcome, runtime and step count that the card states
// outright, and made the same work look like two different features.
const delegateItems = computed<DelegationActivityItem[]>(() =>
  props.items.filter(isDelegationActivityItem),
);
const hasSubagentTopology = computed(() => delegateItems.value.length > 0);
// `Task` rows only ever say "running"; the turn's TaskWait/TaskList/TaskStop rows
// carry how each delegate actually ended (ADR 0089). When the lifecycle tool is in
// a different activity part (the agent emitted text between Task and TaskWait),
// the turn-level statuses computed by the parent give us the cross-part view.
const delegationStatuses = computed(
  () => props.turnDelegationStatuses ?? collectDelegationStatuses(props.items),
);
const delegationTimings = computed(
  () => props.turnDelegationTimings ?? collectDelegationTimings(props.items),
);
const subagentSummary = computed(() =>
  summarizeSubagentActivity(delegateItems.value, delegationStatuses.value),
);
// Parent tools after a Task fan-out live in a later activity part (D319), so this
// card is not the turn's live tail while its delegates are still running.
const topologyLive = computed(
  () => hasSubagentTopology.value && subagentSummary.value.running > 0,
);
const live = computed(() => props.isActive || topologyLive.value);

const searchTarget = useTranscriptSearchTarget();
const revealRequest = computed(() =>
  searchTarget &&
  props.items.some((item) => item.message.id === searchTarget.messageId)
    ? searchTarget.requestId
    : undefined,
);

const { open, toggle, collapse, claim, titleRef } = useAutomaticDisclosure(
  live,
  revealRequest,
);

const now = ref(Date.now());
const finishedAt = ref<number | null>(null);
/** The `wasActiveRef`, latched across renders. */
let wasLive = live.value;
let timer = 0;

function stopClock(): void {
  window.clearInterval(timer);
  timer = 0;
}

 /** The `[live]` watcher body; its not-live path leaves no timer behind. */
function syncClock(): void {
  if (wasLive && !live.value) finishedAt.value = Date.now();
  wasLive = live.value;
  stopClock();
  if (!live.value) return;
  now.value = Date.now();
  timer = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
}

onMounted(syncClock);
watch(live, syncClock);
onScopeDispose(stopClock);

const messages = computed(() => props.items.map((item) => item.message));
const topologyTiming = computed(() =>
  hasSubagentTopology.value
    ? delegationTimingBounds(delegateItems.value, delegationTimings.value)
    : null,
);
const startedAt = computed(() => {
  const topologyStart = topologyTiming.value?.startedAt;
  if (topologyStart !== undefined) return topologyStart;
  return Date.parse(messages.value[0]?.createdAt || "") || now.value;
});
const fallbackEnd = computed(() =>
  Math.max(
    startedAt.value,
    ...messages.value.map(
      (message) =>
        Date.parse(message.toolCompletedAt || "") ||
        (Date.parse(message.createdAt) || startedAt.value) +
          (message.toolDurationMs || 0),
    ),
  ),
);
/**
 * The completed-at fallback: `topologyTiming?.completedAt ?? (Date.parse(endedAt || "") ||
 * finishedAt || (wasActiveRef.current ? now : fallbackEnd))`. Spelled with
 * explicit branches because `finishedAt` is `number | null` and `||` already
 * skips it; the returned value is always a number.
 */
const completedAt = computed(() => {
  const topologyCompleted = topologyTiming.value?.completedAt;
  if (topologyCompleted !== undefined) return topologyCompleted;
  const parsedEnd = Date.parse(props.endedAt || "");
  if (parsedEnd) return parsedEnd;
  if (finishedAt.value) return finishedAt.value;
  return wasLive ? now.value : fallbackEnd.value;
});
const elapsedSeconds = computed(() =>
  Math.max(
    0,
    Math.floor(((live.value ? now.value : completedAt.value) - startedAt.value) / 1000),
  ),
);
const elapsed = computed(() => formatToolDuration(elapsedSeconds.value));

const lastItem = computed(() => props.items[props.items.length - 1]);
const thinkingNow = computed(
  () =>
    props.isActive &&
    lastItem.value?.kind === "thinking" &&
    lastItem.value.message.status === "streaming",
);
const onlyThinking = computed(() =>
  props.items.every((item) => item.kind === "thinking"),
);

const label = computed(() => {
  if (hasSubagentTopology.value) {
    return t(
      live.value
        ? "chat.subagentsWorking"
        : subagentSummary.value.issues > 0
          ? "chat.subagentsFinishedWithIssues"
          : subagentSummary.value.warnings > 0
            ? "chat.subagentsFinishedWithWarnings"
            : "chat.subagentsFinished",
      // A card is now drawn for a lone delegation too, so the aggregate line has
      // to be able to say "Subagent working" and not only the plural.
      { count: subagentSummary.value.total },
    );
  }
  if (props.isActive) {
    return t(thinkingNow.value || onlyThinking.value ? "chat.thinkingFor" : "chat.processingFor", {
      time: elapsed.value,
    });
  }
  if (onlyThinking.value) {
    return elapsedSeconds.value > 0
      ? t("chat.thoughtFor", { time: elapsed.value })
      : // History reloads keep no end timestamp for pure-thinking groups.
        t("chat.thinking");
  }
  return t("chat.processedFor", { time: elapsed.value });
});

const runtimeStatus = computed(() =>
  props.runtimeActivity
    ? runActivityLabel(props.runtimeActivity, t as Translate)
    : "",
);
const currentDetail = computed(() =>
  live.value &&
  !runtimeStatus.value &&
  lastItem.value &&
  !(compact.value && lastItem.value.kind === "thinking")
    ? activityItemDetail(lastItem.value)
    : "",
);
const tail = computed(() => (live.value && !open.value ? currentDetail.value : ""));

const embeddedPlain = computed(
  () => Boolean(props.embedded),
);

const rows = computed(() =>
  renderActivityRows(props.items, !embeddedPlain.value && hasSubagentTopology.value),
);

/** The `if (compact && onlyThinking && !thinkingNow) return null;`. */
const visible = computed(
  () =>
    !(compact.value && onlyThinking.value && !thinkingNow.value) &&
    rows.value.length > 0,
);
/**
 * the `autoOpenLatest = !compact && isLast && itemIndex ===
 * items.length - 1`. The group resolves the part-level half once; each row's
 * own `isLast` supplies the item half in `ActivityGroupRows`.
 */
const autoOpenLatest = computed(() => !compact.value && props.isLast);
const phaseKey = computed(() => props.runtimeActivity?.phase ?? "");
</script>

<script lang="ts">
/**
 * This module exports six things from one file. `<script setup>` cannot
 * export, so the five names that are not this component are re-exported here from
 * their own modules and the component re-exports its own default, exactly the
 * shape `ToolRow.vue` uses for `SubagentRunRows`. Every consumer keeps the
 * specifier (`./ActivityGroup` -> `./ActivityGroup.vue`).
 */
export { default as ActivityGroup } from "./ActivityGroup.vue";
export { default as WorkingIndicator } from "./WorkingIndicator.vue";
export { default as RunActivityIndicator } from "./RunActivityIndicator.vue";
export { default as PlanningIndicator } from "./PlanningIndicator.vue";
export { activityItemDetail, activityItemsEqual, runActivityLabel } from "./activity-group";
</script>

<template>
  <template v-if="visible">
    <div v-if="embeddedPlain" class="turn-process-activity">
      <ActivityGroupRows
        :rows="rows"
        :delegate-items="delegateItems"
        :delegation-statuses="delegationStatuses"
        :delegation-timings="delegationTimings"
        :is-active="props.isActive"
        :live="live"
        :auto-open-latest="autoOpenLatest"
        :on-user-interaction="claim"
      />
    </div>

    <div
      v-else
      class="tool-activity-group"
      :class="[
        { 'has-subagents': hasSubagentTopology, open, active: live },
        {
          'phase-starting': phaseKey === 'starting',
          'phase-waiting-model': phaseKey === 'waiting-model',
          'phase-preparing': phaseKey === 'preparing',
          'phase-compacting': phaseKey === 'compacting',
          'phase-recovering': phaseKey === 'recovering',
          'phase-retrying': phaseKey === 'retrying',
          'phase-waiting-subagents': phaseKey === 'waiting-subagents',
        },
      ]"
    >
      <button
        ref="titleRef"
        class="tool-activity-header"
        :aria-expanded="open"
        :aria-controls="detailsId"
        @click="toggle"
      >
        <span class="tool-activity-icon" aria-hidden="true">
          <IconWorkflow v-if="hasSubagentTopology" :size="15" />
          <IconSparkles v-else :size="14" />
        </span>
        <span class="tool-activity-label" :class="{ running: live }">
          {{ label }}
        </span>
        <span v-if="hasSubagentTopology" class="subagent-activity-metrics">
          {{ t("chat.subagentCount", { count: subagentSummary.total }) }}
          <span aria-hidden="true"> · </span>
          {{
            t("chat.subagentFinishedCount", {
              finished: subagentSummary.finished,
              total: subagentSummary.total,
            })
          }}
          <span aria-hidden="true"> · </span>
          {{ elapsed }}
        </span>
        <span v-else-if="props.items.length > 1" class="tool-activity-count">
          {{ t("chat.processingSteps", { count: props.items.length }) }}
        </span>
        <span class="tool-activity-caret" aria-hidden="true">
          <IconChevronRight :size="12" />
        </span>
      </button>
      <div v-if="tail" class="tool-activity-preview" aria-hidden="true">
        {{ tail }}
      </div>
      <div class="tool-activity-collapse" :aria-hidden="!open" :inert="!open">
        <div class="tool-activity-collapse-inner">
          <div :id="detailsId" class="tool-activity-body">
            <DisclosureCollapseRail
              :label="t('chat.collapseDetails')"
              :on-collapse="collapse"
            />
            <ActivityGroupRows
              :rows="rows"
              :delegate-items="delegateItems"
              :delegation-statuses="delegationStatuses"
              :delegation-timings="delegationTimings"
              :is-active="props.isActive"
              :live="live"
              :auto-open-latest="autoOpenLatest"
              :on-user-interaction="claim"
            />
          </div>
        </div>
      </div>
    </div>
  </template>
</template>
