<script setup lang="ts">
/**
 * One tool call in the transcript: a head that says what the call was and how
 * it ended, and a body that renders the result structurally.
 *
 * The `ToolRow` component.
 *
 * The implementation decisions that are not mechanical:
 *
 *  1. **`SubagentRunRows` is re-exported, not re-declared.** The module
 *     holds two components; `SubagentDetail.vue` imports `SubagentRunRows` from
 *     `./ToolRow` and renders it in its dock variant, so the name has to stay
 *     reachable at this path. The component's markup lives in
 *     `./SubagentRunRows.vue` — an SFC holds one template — and the plain
 *     `<script>` block below re-exports it under the original name.
 *  2. **`onUserInteraction` is the `user-interaction` emit.** The only
 *     callers (`ActivityGroup`, `SubagentDetail`) pass `claimDisclosure` to stop
 *     the automatic disclosure from overriding a user's own toggle. Same shape
 *     as the sibling `HostedSearchRow.vue`.
 *  3. **`memo` and its comparator are gone.** `toolRowPropsEqual` and the
 *     `toolRowDelegationId` helper it used existed only to keep the render
 *     function from re-rendering on a streamed message object; a Vue component re-renders only
 *     when a value its render reads changes, so the whole comparator has no
 *     counterpart.
 *  4. **The root state modifiers are literal in the template.** A single
 *     template literal would glue together
 *     `` `status-${run === "failed" ? "error" : status || "success"}` `` and
 *     `` `outcome-${outcome.replaceAll("_", "-")}` ``. The class-name contract
 *     reads a template literal's static text verbatim, so that form would be
 *     reported as the glued fragments `status-` and `outcome-` rather than as
 *     the eleven names. `statusKey` / `outcomeKey` below therefore carry only
 *     the *selection*, and the template lists every name literally. None of the
 *     eleven has a rule in the shared stylesheet; they are what this component
 *     reports to the maintainer for
 *     `CLASS_ALLOWLIST`, together with `sr-only` (note 7).
 *  5. **`aria-hidden="true"` is explicit.** A bare
 *     `aria-hidden` on the avatar, the status dot and the carets would render
 *     as `""` in a Vue template.
 *  6. **The disclosure's automatic-open gate is a getter.** The hook
 *     takes a ref or a getter (it watches the source), so a literal boolean
 *     would both fail type-checking and make `watch` warn about
 *     an invalid source. Since 39cde7c0 the gate is `autoOpen && !failed &&
 *     status !== "denied"`: detailed mode opens the last tool of the last
 *     activity part, and compact, a failure or a denial stays collapsed.
 *  7. `sr-only` is the Tailwind accessibility utility used for the
 *     two screen-reader-only status announcements. The shared stylesheet never
 *     defines it — the same exemption `ToolDetails.vue`, `PlanApprovalBar.vue`
 *     and `Sidebar.vue` already carry.
 */
import { computed, onMounted, onScopeDispose, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { UiMessage } from "@dcode/shared";
import { useOpenPreviewTarget } from "../../../hooks/use-preview-target";
import { getToolPreviewTarget } from "../../../lib/chat-links";
import {
  formatToolDuration,
  getToolAction,
  getToolDisplayName,
  getToolSummary,
  getToolSummaryValue,
} from "../../../lib/tool-display";
import {
  buildToolPresentation,
  hasToolDetails,
  runOutcome,
  toolResultChips,
  toolResultPayload,
} from "../../../lib/tool-presentation";
import type { SubagentRun } from "../../../lib/assistant-turns";
import {
  delegationIsCreating,
  delegationRoster,
  delegationRosterOutcome,
  delegationRosterSummary,
  lifecycleKindOf,
  subagentOutcome,
  type SubagentOutcome,
  type SubagentTiming,
} from "../../../lib/subagent-topology";
import { useAppStore } from "../../../stores/app-store";
import { delegationIdForMessage } from "../../../lib/subagent-panel";
import { ToolChips, ToolDetailBlocks } from "../../../components/ToolDetails.vue";
import {
  IconBot,
  IconCheck,
  IconChevronRight,
  IconCircleAlert,
  IconStop,
} from "../../../lib/icons";
import {
  LIFECYCLE_LABEL_KEYS,
  LIFECYCLE_RUNNING_KEYS,
  PREVIEWABLE_ACTIONS,
  TOOL_ACTION_KEYS,
  TOOL_RUNNING_KEYS,
  useAutomaticDisclosure,
} from "./shared";
import {
  delegateAgentName,
  delegateModelId,
  delegateThinkingLevel,
  extractSubagentTaskName,
  localizeAgentName,
} from "./model";
import DisclosureCollapseRail from "./DisclosureCollapseRail.vue";
import SubagentRunRows from "./SubagentRunRows.vue";
import ToolActionIcon from "./ToolActionIcon.vue";
import ToolCommandCopy from "./ToolCommandCopy.vue";

const props = withDefaults(
  defineProps<{
    message: UiMessage;
    /** Rows the delegate produced, when this row is a `Task` call (ADR 0062). */
    delegate?: SubagentRun;
    /** Card treatment used when several Task calls form a delegation topology. */
    variant?: "default" | "topology";
    /** Open the latest detailed-mode tool unless the user took over. */
    autoOpen?: boolean;
    /** Live delegation statuses read from the turn's lifecycle-tool rows. */
    delegationStatuses?: ReadonlyMap<string, SubagentOutcome>;
    /** Runtime timings read from the turn's delegation lifecycle rows. */
    delegationTimings?: ReadonlyMap<string, SubagentTiming>;
  }>(),
  { variant: "default" },
);

const emit = defineEmits<{ "user-interaction": [] }>();

const { t, locale } = useI18n();
const detailsId = useId();
const store = useAppStore();
const openTarget = useOpenPreviewTarget();

const root = computed(() => store.appState?.workspace?.path);
const subagentPanel = computed(() => store.appState?.subagentPanel);

const isTopology = computed(() => props.variant === "topology");
const status = computed(() => props.message.toolStatus);
const action = computed(() => getToolAction(props.message.toolName));
// A run row states what the command did, not what the call around it did: an
// exit code the shell reported outranks a tool call that came back fine (D227).
const run = computed(() =>
  action.value === "run" ? runOutcome(props.message) : null,
);
const failed = computed(() => status.value === "error" || run.value === "failed");
/**
 * The token interpolated into `status-…`: a run
 * row's own outcome outranks the call's status, and a call with no status at
 * all reads `success`. Only the *selection* lives in script — the four class
 * names themselves stay literal in the template, because the class-name
 * contract reads a template literal's static text verbatim and would report the
 * glued fragment `status-` instead of the names.
 */
const statusKey = computed(() =>
  run.value === "failed" ? "error" : status.value || "success",
);
// Detailed mode opens the last tool of the last activity group. Compact keeps
// payloads collapsed so a live burst only updates the header. Failure and
// denial stay in the row head without expanding the payload automatically.
const { open, toggle, collapse, titleRef } = useAutomaticDisclosure(
  () => Boolean(props.autoOpen) && !failed.value && status.value !== "denied",
);

function toggleRow(): void {
  emit("user-interaction");
  toggle();
}

function collapseRow(): void {
  emit("user-interaction");
  collapse();
}

const actionLabel = computed(() =>
  t(
    status.value === "running"
      ? TOOL_RUNNING_KEYS[action.value]
      : TOOL_ACTION_KEYS[action.value],
  ),
);
const rawName = computed(() => getToolDisplayName(props.message.toolName) || t("chat.tool"));
const argSummary = computed(() =>
  getToolSummary(props.message.toolName, props.message.toolArgs),
);
const previewTarget = computed(() =>
  PREVIEWABLE_ACTIONS.has(action.value)
    ? getToolPreviewTarget(props.message.toolArgs, root.value)
    : null,
);
// A run row keeps its command in the head and only its output in the body, so
// the head carries the two things the body no longer offers: a copy of the
// command, and the outcome (D226).
const runHead = computed(() => action.value === "run" && !isTopology.value);
const command = computed(() =>
  runHead.value
    ? getToolSummaryValue(props.message.toolName, props.message.toolArgs)
    : "",
);
// A delegation is always expandable: its brief, report and the delegate's own
// rows all live in the body.
const hasDetails = computed(
  () => hasToolDetails(props.message) || Boolean(props.delegate),
);
const chips = computed(() => toolResultChips(props.message));
// A lifecycle row (ADR 0089) is about subagents, so it is presented as one: the
// agent names it reports on replace the bare delegation ids it was called with,
// and its badge rolls up their statuses (D268).
const lifecycle = computed(() =>
  action.value === "delegate" ? lifecycleKindOf(props.message) : null,
);
const roster = computed(() =>
  lifecycle.value ? delegationRoster(props.message) : [],
);
const rosterSummary = computed(() =>
  lifecycle.value ? delegationRosterSummary(roster.value) : "",
);
const rosterOutcome = computed(() =>
  lifecycle.value ? delegationRosterOutcome(roster.value) : null,
);
const agentName = computed(() =>
  action.value === "delegate" && !lifecycle.value
    ? delegateAgentName(props.message, props.delegate)
    : "",
);
const isDelegate = computed(
  () => action.value === "delegate" && !lifecycle.value,
);
const isZh = computed(() => Boolean(locale.value?.startsWith("zh")));
const displayAgentName = computed(() =>
  localizeAgentName(agentName.value, isZh.value) || t("chat.subagentUnnamed"),
);
const agentPrefix = computed(() => t("chat.subagentAgent"));
const modelId = computed(() =>
  isTopology.value ? delegateModelId(props.message) : "",
);
const thinkingLabel = computed(() =>
  isTopology.value ? (delegateThinkingLevel(props.message) ?? "") : "",
);
const modelLabel = computed(() =>
  [modelId.value, thinkingLabel.value].filter(Boolean).join(" "),
);
// The delegate's last answer row is its report, so the body must not print the
// same text a second time.
const nestedReport = computed(() =>
  Boolean(props.delegate?.items.some((item) => item.kind === "answer")),
);
// Streaming updates replace the message object each tick; only pay the full
// payload walk once the row is actually expanded.
const blocks = computed(() =>
  !isTopology.value && open.value && hasDetails.value
    ? buildToolPresentation(props.message, {
        hideSummaryArg: true,
        ...(nestedReport.value ? { hideDelegateReport: true } : {}),
      })
    : null,
);
const outcome = computed(() =>
  isTopology.value || isDelegate.value
    ? subagentOutcome(props.message, props.delegationStatuses)
    : null,
);
// A bare `running` Task row (no delegation result yet) is still being created:
// the delegate runtime is spawning and no structured snapshot exists. Show it
// as starting rather than a generic running state.
const creating = computed(
  () =>
    isTopology.value &&
    outcome.value === "running" &&
    delegationIsCreating(props.message),
);
const runLabel = computed(() =>
  run.value === "running"
    ? t("chat.running")
    : run.value === "failed"
      ? t("chat.toolFailed")
      : run.value === "denied"
        ? t("chat.toolDenied")
        : run.value === "ok"
          ? t("chat.toolCompleted")
          : "",
);
// A lifecycle row never falls back to its arguments: while it is still running
// it has no roster yet, and `delegationIds` would otherwise reach the head as a
// JSON blob of UUIDs (D268).
const summary = computed(() =>
  lifecycle.value ? rosterSummary.value : argSummary.value,
);
const subagentSummaryText = computed(() => {
  if (isDelegate.value) {
    const taskName = extractSubagentTaskName(props.message);
    if (taskName) {
      const clean = taskName.trim().replace(/\s+/g, " ");
      return clean.length > 80 ? `${clean.slice(0, 79)}…` : clean;
    }
  }
  if (summary.value) return summary.value;
  const args = props.message.toolArgs;
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const task = (args as { task?: unknown }).task;
    if (typeof task === "string" && task.trim()) {
      const clean = task.trim().replace(/\s+/g, " ");
      return clean.length > 80 ? `${clean.slice(0, 79)}…` : clean;
    }
  }
  return "";
});
const statusLabel = computed(() => {
  if (creating.value) return t("chat.subagentCreating");
  if (outcome.value) return t(`chat.subagentStatus.${outcome.value}`);
  if (rosterOutcome.value) return t(`chat.subagentStatus.${rosterOutcome.value}`);
  if (run.value) return runLabel.value;
  if (status.value === "running") return t("chat.running");
  if (status.value === "error") return t("chat.toolFailed");
  if (status.value === "denied") return t("chat.toolDenied");
  return t("chat.toolCompleted");
});
const nameLabel = computed(() =>
  lifecycle.value
    ? t(
        (status.value === "running"
          ? LIFECYCLE_RUNNING_KEYS
          : LIFECYCLE_LABEL_KEYS)[lifecycle.value],
      )
    : actionLabel.value,
);
const delegationPayload = computed(() =>
  isTopology.value || isDelegate.value ? toolResultPayload(props.message) : undefined,
);
const delegationId = computed(() => {
  const payload = delegationPayload.value;
  if (
    payload &&
    typeof payload === "object" &&
    typeof (payload as { delegationId?: unknown }).delegationId === "string"
  ) {
    return (payload as { delegationId: string }).delegationId;
  }
  return delegationIdForMessage(props.message) || props.message.toolCallId || undefined;
});
const panelSelectionId = computed(() =>
  typeof delegationId.value === "string" && delegationId.value
    ? delegationId.value
    : props.message.toolCallId || props.message.id,
);
const panelOpen = computed(
  () =>
    subagentPanel.value?.delegationId === panelSelectionId.value,
);
const renderedOpen = computed(() =>
  isTopology.value || isDelegate.value ? panelOpen.value : open.value,
);
const inlineOpen = computed(() => !isTopology.value && !isDelegate.value && open.value);
const delegationTiming = computed(() =>
  typeof delegationId.value === "string"
    ? props.delegationTimings?.get(delegationId.value)
    : undefined,
);

const now = ref(Date.now());
let timer = 0;

function stopClock(): void {
  window.clearInterval(timer);
  timer = 0;
}

/** The clock effect body; its non-running path leaves no timer behind. */
function syncClock(): void {
  stopClock();
  if (outcome.value !== "running") return;
  now.value = Date.now();
  timer = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
}

onMounted(syncClock);
watch(outcome, syncClock);
onScopeDispose(stopClock);

// While a delegation is still being created it has no `startedAt` in the
// result, so the elapsed clock ticks from the call's own timestamp instead of
// waiting for the Task handle — the node never reads as stalled.
const nodeStartedAt = computed(() => {
  const timing = delegationTiming.value;
  if (timing?.startedAt !== undefined) return timing.startedAt;
  return creating.value && props.message.createdAt
    ? Date.parse(props.message.createdAt) || undefined
    : undefined;
});
const durationMs = computed(() => {
  const startedAt = nodeStartedAt.value;
  if (startedAt === undefined) return props.message.toolDurationMs;
  const timing = delegationTiming.value;
  return Math.max(
    0,
    (timing?.completedAt ??
      (outcome.value === "running" ? now.value : startedAt)) - startedAt,
  );
});
const duration = computed(() =>
  typeof durationMs.value === "number" && durationMs.value > 0
    ? formatToolDuration(durationMs.value / 1000)
    : "",
);
const durationText = computed(() =>
  duration.value ? ` · ${duration.value}` : "",
);

const subagentStepCount = computed(() => {
  if (props.delegate?.items.length) {
    return props.delegate.items.length;
  }
  const payload = delegationPayload.value;
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    if (typeof rec.toolCalls === "number" && rec.toolCalls > 0) {
      return rec.toolCalls;
    }
    if (typeof rec.turns === "number" && rec.turns > 0) {
      return rec.turns;
    }
  }
  return 0;
});
const subagentStepsText = computed(() =>
  subagentStepCount.value > 0
    ? t("chat.processingSteps", { count: subagentStepCount.value })
    : "",
);
const subagentDurationText = computed(() => duration.value || "");
const isSubagentDone = computed(
  () =>
    isDelegate.value &&
    outcome.value !== "running" &&
    status.value !== "running" &&
    !creating.value,
);

const statusTone = computed(() => {
  if (isDelegate.value) {
    if (outcome.value === "running" || status.value === "running" || creating.value) {
      return "is-running";
    }
    if (
      outcome.value === "failed" ||
      outcome.value === "timed_out" ||
      status.value === "error"
    ) {
      return "is-error";
    }
    if (
      outcome.value === "aborted" ||
      outcome.value === "stopped" ||
      outcome.value === "denied" ||
      status.value === "denied"
    ) {
      return "is-denied";
    }
    return "is-done";
  }
  return run.value === "running" || (!run.value && status.value === "running")
    ? "is-running"
    : failed.value
      ? "is-error"
      : run.value === "denied" || (!run.value && status.value === "denied")
        ? "is-denied"
        : "is-done";
});
/**
 * `outcome.replaceAll("_", "-")` from the root class expression.
 * The seven `outcome-*` names are written out in the template instead of being
 * composed here, for the same reason `statusKey` exists.
 */
const outcomeKey = computed(() =>
  outcome.value ? outcome.value.replaceAll("_", "-") : "",
);

const nodeTitle = computed(() =>
  [
    isDelegate.value
      ? `${agentPrefix.value} ${displayAgentName.value}`
      : agentName.value || rawName.value,
    modelLabel.value,
    isDelegate.value ? subagentSummaryText.value : summary.value,
  ]
    .filter(Boolean)
    .join(" · "),
);
const previewTitle = computed(() =>
  previewTarget.value
    ? previewTarget.value.kind === "file"
      ? t("chat.previewFile")
      : t("chat.previewUrl")
    : undefined,
);
const ariaLabel = computed(() =>
  isDelegate.value
    ? `${agentPrefix.value} ${displayAgentName.value}${subagentSummaryText.value ? `: ${subagentSummaryText.value}` : ""}${statusLabel.value ? `, ${statusLabel.value}` : ""}`
    : `${t("chat.toolCall")}: ${rawName.value}${agentName.value ? `, ${agentName.value}` : ""}${modelLabel.value ? `, ${modelLabel.value}` : ""}${statusLabel.value ? `, ${statusLabel.value}` : ""}`,
);

function onNodeClick(): void {
  if (!hasDetails.value) return;
  emit("user-interaction");
  store.appState?.toggleSubagentPanel(panelSelectionId.value);
}

function handleRowHeaderClick(): void {
  if (isDelegate.value) {
    emit("user-interaction");
    store.appState?.toggleSubagentPanel(panelSelectionId.value);
    return;
  }
  if (hasDetails.value) {
    toggleRow();
  }
}

/** Open the preview target instead of toggling details. */
function onSummaryClick(event: MouseEvent): void {
  const target = previewTarget.value;
  if (!target) return;
  event.stopPropagation();
  openTarget(target);
}
</script>

<script lang="ts">
/**
 * This module exports `ToolRow` and `SubagentRunRows` from one file, and
 * `SubagentDetail.vue` imports both from `./ToolRow`. `<script setup>` cannot
 * export, so the second component's name is re-exported here from its own SFC
 * and both importers keep the original specifier.
 */
export { default as SubagentRunRows } from "./SubagentRunRows.vue";
</script>

<template>
  <div
    class="tool-row"
    :class="[
      { 'subagent-topology-node': isTopology, open: renderedOpen },
      {
        'status-running': statusKey === 'running',
        'status-success': statusKey === 'success',
        'status-error': statusKey === 'error',
        'status-denied': statusKey === 'denied',
      },
      {
        'outcome-running': outcomeKey === 'running',
        'outcome-completed': outcomeKey === 'completed',
        'outcome-timed-out': outcomeKey === 'timed-out',
        'outcome-aborted': outcomeKey === 'aborted',
        'outcome-failed': outcomeKey === 'failed',
        'outcome-stopped': outcomeKey === 'stopped',
        'outcome-denied': outcomeKey === 'denied',
        'outcome-creating': creating,
      },
    ]"
    :role="isTopology ? 'listitem' : 'region'"
    :data-message-id="props.message.id"
    :aria-label="ariaLabel"
  >
    <button
      v-if="isTopology"
      type="button"
      class="subagent-topology-node-header"
      :aria-expanded="panelOpen"
      :aria-controls="hasDetails ? 'subagent-panel' : undefined"
      :disabled="!hasDetails"
      :title="nodeTitle"
      @click="onNodeClick"
    >
      <span class="subagent-topology-avatar" aria-hidden="true">
        <IconBot :size="15" />
        <span class="subagent-topology-status-icon">
          <IconCheck v-if="outcome === 'completed'" :size="8" />
          <IconStop v-else-if="outcome === 'aborted'" :size="7" />
          <span v-else-if="outcome === 'running'" />
          <IconCircleAlert v-else :size="8" />
        </span>
      </span>
      <span class="subagent-topology-node-copy">
        <span class="subagent-topology-node-title-row">
          <span class="subagent-topology-node-title">
            {{ displayAgentName || t("chat.subagentUnnamed") }}
          </span>
          <span
            v-if="modelLabel"
            class="subagent-topology-node-model"
            :title="modelLabel"
            :aria-label="modelLabel"
          >
            {{ modelLabel }}
          </span>
          <span class="subagent-topology-node-status">
            {{ statusLabel }}{{ durationText }}
          </span>
        </span>
        <span v-if="summary" class="subagent-topology-node-summary">
          {{ summary }}
        </span>
        <span
          v-if="props.delegate?.items.length"
          class="subagent-topology-node-steps"
        >
          {{ t("chat.processingSteps", { count: props.delegate.items.length }) }}
        </span>
      </span>
      <span
        v-if="outcome === 'running'"
        class="tool-spinner"
        :aria-label="t('chat.running')"
      />
    </button>

    <div v-else class="tool-row-head" :class="{ 'is-run': runHead }">
      <button
        ref="titleRef"
        type="button"
        class="tool-row-header"
        :aria-expanded="isDelegate ? panelOpen : open"
        :aria-controls="isDelegate ? 'subagent-panel' : (hasDetails ? detailsId : undefined)"
        :disabled="!hasDetails"
        :title="isDelegate ? t('chat.viewExecutionInSidebar') : (summary || rawName)"
        @click="handleRowHeaderClick"
      >
        <template v-if="isDelegate">
          <span class="tool-row-icon is-subagent">
            <ToolActionIcon :action="action" />
          </span>
          <span class="tool-subagent-label">
            <span class="tool-subagent-prefix">{{ agentPrefix }}</span>
            <span class="tool-subagent-name">{{ displayAgentName }}</span>
          </span>
          <span v-if="subagentSummaryText" class="tool-subagent-separator" aria-hidden="true">·</span>
          <span
            v-if="subagentSummaryText"
            class="tool-row-summary is-subagent"
            :class="{ linked: previewTarget }"
            :title="previewTitle || subagentSummaryText"
            @click="onSummaryClick"
          >
            {{ subagentSummaryText }}
          </span>
          <span
            v-if="isSubagentDone && (subagentStepsText || subagentDurationText)"
            class="tool-row-chips tool-subagent-meta"
          >
            <span v-if="subagentStepsText" class="tool-chip">{{ subagentStepsText }}</span>
            <span v-if="subagentDurationText" class="tool-chip">{{ subagentDurationText }}</span>
          </span>
          <span
            v-if="statusLabel"
            class="tool-row-state"
            :class="statusTone"
            role="status"
            aria-live="polite"
          >
            <span class="tool-row-state-dot" aria-hidden="true" />
            {{ statusLabel }}
          </span>
        </template>

        <template v-else>
          <span class="tool-row-icon" :class="{ 'is-subagent': lifecycle }">
            <ToolActionIcon :action="action" />
          </span>
          <span class="tool-row-name" :class="{ running: status === 'running' }">
            {{ nameLabel }}
          </span>
          <span
            v-if="lifecycle && roster.length > 0"
            class="tool-row-agent is-count"
          >
            {{ t("chat.subagentCount", { count: roster.length }) }}
          </span>
          <span
            v-if="agentName"
            class="tool-row-agent"
            :title="t('chat.subagentAgent')"
          >
            {{ agentName }}
          </span>
          <span
            v-if="summary"
            class="tool-row-summary"
            :class="{ linked: previewTarget }"
            :title="previewTitle"
            @click="onSummaryClick"
          >
            {{ summary }}
          </span>
          <ToolChips :chips="chips" />
          <span
            v-if="runHead && statusLabel"
            class="tool-row-state"
            :class="statusTone"
            role="status"
            aria-live="polite"
          >
            <span class="tool-row-state-dot" aria-hidden="true" />
            {{ statusLabel }}
          </span>
          <span
            v-else-if="status === 'running'"
            class="tool-spinner"
            :aria-label="t('chat.running')"
          />
          <span
            v-else-if="status === 'error'"
            class="tool-row-status error"
            :aria-label="t('chat.toolFailed')"
          >
            <IconCircleAlert :size="13" />
            {{ t("chat.toolFailed") }}
          </span>
          <span v-else-if="status === 'denied'" class="tool-row-status">
            {{ t("chat.toolDenied") }}
          </span>
        </template>
        <span
          v-if="!((runHead || isDelegate) && statusLabel)"
          class="sr-only"
          role="status"
          aria-live="polite"
        >
          {{ statusLabel }}
        </span>
        <span v-if="!runHead && hasDetails" class="tool-row-caret" aria-hidden="true">
          <IconChevronRight :size="12" />
        </span>
      </button>
      <ToolCommandCopy v-if="runHead && command" :command="command" />
      <!--
        Redundant for the keyboard — the header itself is the disclosure — so it
        is a pointer target only and stays out of the reading order.
      -->
      <button
        v-if="runHead && hasDetails"
        type="button"
        class="tool-row-caret is-toggle"
        aria-hidden="true"
        :tabindex="-1"
        @click="toggleRow"
      >
        <IconChevronRight :size="12" />
      </button>
    </div>

    <span
      v-if="isTopology"
      class="sr-only"
      role="status"
      aria-live="polite"
    >
      {{ statusLabel }}
    </span>

    <div v-if="blocks && blocks.length > 0" :id="detailsId" class="tool-row-body">
      <DisclosureCollapseRail
        :label="t('chat.collapseDetails')"
        :on-collapse="collapseRow"
      />
      <ToolDetailBlocks :blocks="blocks" :plain="runHead" />
    </div>

    <SubagentRunRows
      v-if="inlineOpen && props.delegate"
      :run="props.delegate"
      :agent-name="displayAgentName"
      :on-collapse="collapseRow"
    />
  </div>
</template>
