<script setup lang="ts">
/**
 * The side-sheet view for a selected delegate. It shows a sticky identity
 * header, the task as an inset grouped card, and the live process timeline.
 * Reports and counters remain omitted from this compact surface.
 *
 * The `SubagentDetail` component.
 *
 * **Both exports stay reachable from this path.** `SubagentDetail` is
 * the SFC's default export; `SubagentTopology` is re-exported by the plain
 * `<script>` block below from its own SFC, exactly the way `ToolRow.vue`
 * re-exports `SubagentRunRows` — `ActivityGroup.vue` imports the topology as a
 * named binding from `./SubagentDetail`, so the specifier has to keep
 * answering it. The two module-private pieces moved out for the same reason:
 * an SFC holds a single template, so the failure card (`SubagentFailureCard`,
 * lines 51-130) and the topology each became
 * their own file. The failure card split is load-bearing, not cosmetic: it owns
 * its own `open` state, and the state is reset by unmounting it whenever
 * the condition at the call site flips, which a `ref` in this parent would
 * not reproduce.
 *
 * The decisions that are not mechanical:
 *  1. **`useLayoutEffect` is a `watch`.** The first one collapses the task card
 *     when the brief changes (`[taskDescription]`), the second re-measures the
 *     body for overflow and re-installs its `ResizeObserver` on `[taskDescription,
 *     taskExpanded]`. Vue has no layout effect, so the measurement runs from
 *     `onMounted` plus a `flush: "post"` watcher — after the DOM update that
 *     could have changed the scroll height, which is the timing the layout
 *     effect had.
 *  2. **The running clock is `onMounted` + `watch(outcome)` + `onScopeDispose`**,
 * the same shape `ToolRow.vue` uses for its elapsed node: the effect body
 *     installs no timer on its non-running path, and the teardown
 *     is the scope disposal.
 * 3. **`statusClass` only carries the selection.** The class was built as
 *     `` `subagent-detail-status outcome-${statusClass}` `` from a ternary, and
 *     `statusClass` itself from `outcome.replaceAll("_", "-")`. The class-name
 *     contract reads a template literal's static text verbatim, so that form
 *     would be reported as the glued fragment `outcome-` instead of the eight
 *     names; the template therefore lists every `outcome-*` name literally as an
 *     object key, and `statusClass` holds only which one is true.
 *  4. **`createPortal` never appears here.** Nothing mounts
 *     outside its subtree, so no `<Teleport>` is needed.
 *  5. **`aria-hidden="true"` is explicit** on the avatar: a bare attribute in a
 *     Vue template renders as `""` where `"true"` is intended.
 *  6. **`t("a.b", "Fallback")` becomes `t("a.b")`**, and `useMemo` is a
 *     `computed`.
 */
import { computed, onMounted, onScopeDispose, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { UiMessage } from "@dcode/shared";
import { formatToolDuration } from "../../../lib/tool-display";
import { toolResultPayload } from "../../../lib/tool-presentation";
import {
  delegationIsCreating,
  subagentOutcome,
  type DelegationFailure,
  type SubagentOutcome,
  type SubagentTiming,
} from "../../../lib/subagent-topology";
import type { SubagentRun } from "../../../lib/assistant-turns";
import { useDisclosureAnchorNotifier } from "../../../lib/disclosure-anchor-context";
import { IconBot, IconChevronDown } from "../../../lib/icons";
import {
  delegateAgentName,
  delegateModelId,
  delegateThinkingLevel,
  localizeAgentName,
} from "./model";
import { SubagentRunRows } from "./ToolRow.vue";
import SubagentFailureCard from "./SubagentFailureCard.vue";

const props = defineProps<{
  message: UiMessage;
  delegate?: SubagentRun;
  delegationStatuses?: ReadonlyMap<string, SubagentOutcome>;
  delegationFailures?: ReadonlyMap<string, DelegationFailure>;
  delegationTimings?: ReadonlyMap<string, SubagentTiming>;
}>();

const { t, locale } = useI18n();

/** The `task` argument of the `Task` call, trimmed; `""` when it has none. */
function delegateTaskDescription(message: UiMessage): string {
  const args = message.toolArgs;
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const task = (args as { task?: unknown }).task;
  return typeof task === "string" ? task.trim() : "";
}

const rawAgentName = computed(() => delegateAgentName(props.message, props.delegate));
const isZh = computed(() => Boolean(locale.value?.startsWith("zh")));
const agentName = computed(() => localizeAgentName(rawAgentName.value, isZh.value));
const modelId = computed(() => delegateModelId(props.message));
const thinkingLevel = computed(() => delegateThinkingLevel(props.message));
const thinkingLabel = computed(() => thinkingLevel.value ?? "");
const modelLabel = computed(() =>
  [modelId.value, thinkingLabel.value].filter(Boolean).join(" "),
);
const outcome = computed(() =>
  subagentOutcome(props.message, props.delegationStatuses),
);
// A bare `running` Task row (no delegation handle yet) is still being
// created: the delegate runtime is spawning. Name that phase explicitly
// instead of a generic running state, and keep the badge class distinct.
const creating = computed(
  () => outcome.value === "running" && delegationIsCreating(props.message),
);
const statusKey = computed(() =>
  creating.value ? "chat.subagentCreating" : `chat.subagentStatus.${outcome.value}`,
);
const payload = computed(() => toolResultPayload(props.message));
const payloadRecord = computed(() => {
  const value = payload.value;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as { delegationId?: unknown; startedAt?: unknown; completedAt?: unknown })
    : undefined;
});
const delegationId = computed(() =>
  typeof payloadRecord.value?.delegationId === "string"
    ? payloadRecord.value.delegationId
    : props.message.toolCallId || props.message.id,
);
const timing = computed(() => props.delegationTimings?.get(delegationId.value));
const failure = computed(() => props.delegationFailures?.get(delegationId.value));
const startedAt = computed(() => {
  if (timing.value?.startedAt !== undefined) return timing.value.startedAt;
  if (typeof payloadRecord.value?.startedAt === "number") {
    return payloadRecord.value.startedAt;
  }
  return creating.value && props.message.createdAt
    ? Date.parse(props.message.createdAt) || undefined
    : undefined;
});
const completedAt = computed(() =>
  timing.value?.completedAt !== undefined
    ? timing.value.completedAt
    : typeof payloadRecord.value?.completedAt === "number"
      ? payloadRecord.value.completedAt
      : undefined,
);

const now = ref(Date.now());
let timer = 0;

function stopClock(): void {
  window.clearInterval(timer);
  timer = 0;
}

 /** The clock body; its non-running path leaves no timer behind. */
function syncClock(): void {
  stopClock();
  if (outcome.value !== "running") return;
  now.value = Date.now();
  timer = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
}

const durationMs = computed(() => {
  const started = startedAt.value;
  if (started === undefined) return props.message.toolDurationMs;
  return Math.max(
    0,
    (completedAt.value ?? (outcome.value === "running" ? now.value : started)) - started,
  );
});
const duration = computed(() =>
  typeof durationMs.value === "number" && durationMs.value > 0
    ? formatToolDuration(durationMs.value / 1000)
    : "",
);
/**
 * The outcome token the two `outcome-*` class bindings select between, plus the
 * distinct `creating` phase. `creating` is exclusive: the ternary
 * replaced the outcome name outright rather than adding to it.
 */
const statusClass = computed(() =>
  creating.value ? "creating" : outcome.value.replaceAll("_", "-"),
);

const taskDescription = computed(() => delegateTaskDescription(props.message));
const taskBodyId = useId();
const taskLabelId = useId();
const taskBodyRef = ref<HTMLDivElement | null>(null);
const taskExpanded = ref(false);
const taskToggleRef = ref<HTMLButtonElement | null>(null);
const notifyDisclosureAnchor = useDisclosureAnchorNotifier();
const taskOverflow = ref(false);

// The brief changed, so the previous expansion no longer describes it.
watch(taskDescription, () => {
  taskExpanded.value = false;
});

let observer: ResizeObserver | null = null;

/**
 * The measure closure: `setTaskOverflow((current) => …)` keeps the
 * current value while expanded: an expanded body does not overflow, and
 * recomputing would take away the toggle that collapses it again.
 */
function measureTaskOverflow(): void {
  const element = taskBodyRef.value;
  if (!element) return;
  const overflowing = element.scrollHeight > element.clientHeight + 1;
  if (!taskExpanded.value) taskOverflow.value = overflowing;
}

/** Re-install the observer: the element identity survives, the deps do not. */
function observeTaskOverflow(): void {
  observer?.disconnect();
  observer = null;
  const element = taskBodyRef.value;
  if (!element) return;
  measureTaskOverflow();
  observer = new ResizeObserver(measureTaskOverflow);
  observer.observe(element);
}

function stopObservingTaskOverflow(): void {
  observer?.disconnect();
  observer = null;
}

onMounted(() => {
  syncClock();
  observeTaskOverflow();
});
watch(outcome, syncClock);
watch([taskDescription, taskExpanded], observeTaskOverflow, { flush: "post" });
onScopeDispose(() => {
  stopClock();
  stopObservingTaskOverflow();
});

/** Expanding the brief changes this card's height, so it holds its reading
 * position like the tool and activity titles do (#324). */
function toggleTask(): void {
  notifyDisclosureAnchor?.(taskToggleRef.value);
  taskExpanded.value = !taskExpanded.value;
}
</script>

<script lang="ts">
/**
 * The module exports `SubagentDetail` and `SubagentTopology` from one
 * file, and `ActivityGroup.vue` imports the topology by name from
 * `./SubagentDetail`. `<script setup>` cannot export, so the second component's
 * name is re-exported here from its own SFC and that importer keeps the same
 * specifier.
 */
export { default as SubagentTopology } from "./SubagentTopology.vue";
</script>

<template>
  <div class="subagent-detail" data-testid="subagent-detail">
    <header class="subagent-detail-hero">
      <div class="subagent-detail-heading">
        <span class="subagent-detail-avatar" aria-hidden="true">
          <IconBot :size="18" />
          <span
            class="subagent-detail-status"
            :class="{
              'outcome-creating': statusClass === 'creating',
              'outcome-running': statusClass === 'running',
              'outcome-completed': statusClass === 'completed',
              'outcome-timed-out': statusClass === 'timed-out',
              'outcome-aborted': statusClass === 'aborted',
              'outcome-failed': statusClass === 'failed',
              'outcome-stopped': statusClass === 'stopped',
              'outcome-denied': statusClass === 'denied',
            }"
          />
        </span>
        <div class="subagent-detail-heading-copy">
          <strong class="subagent-detail-name">
            {{ agentName || t("chat.subagentUnnamed") }}
          </strong>
          <span
            v-if="modelLabel"
            class="subagent-detail-model"
            :title="modelLabel"
            :aria-label="modelLabel"
          >
            {{ modelLabel }}
          </span>
        </div>
      </div>
      <div
        class="subagent-detail-summary"
        role="list"
        :aria-label="t('panel.subagent')"
      >
        <span
          class="subagent-detail-badge"
          :class="{
            'outcome-creating': statusClass === 'creating',
            'outcome-running': statusClass === 'running',
            'outcome-completed': statusClass === 'completed',
            'outcome-timed-out': statusClass === 'timed-out',
            'outcome-aborted': statusClass === 'aborted',
            'outcome-failed': statusClass === 'failed',
            'outcome-stopped': statusClass === 'stopped',
            'outcome-denied': statusClass === 'denied',
          }"
          role="listitem"
        >
          {{ t(statusKey) }}
        </span>
        <span v-if="duration" class="subagent-detail-meta" role="listitem">
          {{ duration }}
        </span>
      </div>
    </header>
    <section class="subagent-detail-task" :aria-labelledby="taskLabelId">
      <div class="subagent-detail-section-label" :id="taskLabelId">
        {{ t("panel.subagentTask") }}
      </div>
      <div class="subagent-detail-task-card">
        <div
          :id="taskBodyId"
          ref="taskBodyRef"
          class="subagent-task-message-body selectable"
          :class="taskExpanded ? 'is-expanded' : 'is-collapsed'"
        >
          {{ taskDescription || t("panel.subagentTaskEmpty") }}
        </div>
        <button
          v-if="taskOverflow"
          ref="taskToggleRef"
          type="button"
          class="subagent-task-toggle"
          :aria-expanded="taskExpanded"
          :aria-controls="taskBodyId"
          @click="toggleTask"
        >
          <span>
            {{
              taskExpanded
                ? t("chat.subagentTaskCollapse")
                : t("chat.subagentTaskExpand")
            }}
          </span>
          <IconChevronDown :size="12" aria-hidden="true" />
        </button>
      </div>
    </section>
    <SubagentRunRows
      v-if="props.delegate"
      :run="props.delegate"
      :agent-name="agentName"
      :scrollable="false"
      variant="dock"
    />
    <!--
      A completed delegate has nothing to explain, so the card is tied to a
      non-success terminal outcome rather than to the error field alone.
    -->
    <SubagentFailureCard
      v-if="failure && outcome !== 'completed' && outcome !== 'running'"
      :outcome="outcome"
      :failure="failure"
    />
  </div>
</template>
