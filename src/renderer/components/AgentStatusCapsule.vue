<script setup lang="ts">
/**
 * Agent Status Bar & Capsules (floating in top-right when subagents are executing).
 *
 * Displays:
 *  - Automatically arranges multiple subagents horizontally side-by-side
 *  - Real-time concise behavior per subagent: 运行 (Running), 读取 (Reading), 思考 (Thinking), 写入 (Writing), 等待 (Waiting)
 *  - If a subagent encounters network issues/retries/timeouts, displays "等待" (Waiting)
 *  - Stripped of redundant session titles and parentheses
 *  - Strict execution timing: only appears in reasoning mode (mode === "agent") when subagents are actively executing
 *    (or just completed within a 1.4s fadeout window)
 *  - Clicking on a capsule opens that subagent's execution process in the sidebar (WorkPanel)
 *    and smoothly scrolls the chat transcript to the latest turn
 *  - One-click stop/abort button on hover
 */
import { computed, onScopeDispose, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Mode, UiMessage } from "@dcode/shared";
import { useAppStore } from "../stores/app-store";
import { formatToolDuration, getToolAction } from "../lib/tool-display";
import { delegationIdForMessage } from "../lib/subagent-panel";
import {
  buildTranscriptEntries,
  type AssistantActivityItem,
  type AssistantTurnEntry,
} from "../lib/assistant-turns";
import {
  collectDelegationFailures,
  collectDelegationStatuses,
  collectDelegationTimings,
  isDelegationActivityItem,
  subagentOutcome,
  type DelegationActivityItem,
  type DelegationFailure,
  type SubagentOutcome,
  type SubagentTiming,
} from "../lib/subagent-topology";
import {
  delegateAgentName,
  extractSubagentTaskName,
  formatSubagentStatusTitle,
  localizeAgentName,
} from "../features/chat/transcript/model";
import { toolResultPayload } from "../lib/tool-presentation";
import { IconArrowRight, IconCheck, IconClock, IconStop } from "../lib/icons";

const props = withDefaults(
  defineProps<{
    sessionId?: string;
    messages?: UiMessage[];
    isRunning?: boolean;
    isBrowsingHistory?: boolean;
  }>(),
  {
    sessionId: undefined,
    messages: undefined,
    isRunning: undefined,
    isBrowsingHistory: false,
  },
);

const { t, locale } = useI18n();
const store = useAppStore();

const targetSessionId = computed(() => props.sessionId || store.appState?.activeSessionId);

const activeSession = computed(() =>
  targetSessionId.value
    ? store.appState?.sessions.find((s) => s.id === targetSessionId.value)
    : undefined,
);

const sessionMode = computed<Mode>(() =>
  activeSession.value?.mode ??
  (store.appState?.draftConfiguration?.mode ?? store.appState?.settings?.defaultMode ?? "agent"),
);

/**
 * Execution Timing (执行时机):
 * The status bar is STRICTLY for reasoning mode (mode === "agent") where subagents are invoked.
 * Planning mode (mode === "plan" or planning state active) and Goal mode must never display it.
 */
const isAgentMode = computed(() => {
  if (!targetSessionId.value) return false;

  const planningState = store.appState?.planningStates[targetSessionId.value];
  if (planningState === "planning" || planningState === "awaiting_approval") {
    return false;
  }

  const planCheckpoint = store.appState?.planCheckpoints[targetSessionId.value];
  if (planCheckpoint?.status === "pending") {
    return false;
  }

  return sessionMode.value === "agent";
});

const isRunning = computed(() => {
  if (!targetSessionId.value || !isAgentMode.value) return false;
  if (props.isRunning !== undefined) return props.isRunning;
  return Boolean(
    store.appState?.runningSessions[targetSessionId.value] ?? store.appState?.isRunning,
  );
});

// Latest messages in active session
const latestMessages = computed(() => props.messages ?? (store.appState?.messages ?? []));

// All activity items across all assistant turns in the session to ensure all running subagents are captured
const allSessionActivityItems = computed<AssistantActivityItem[]>(() => {
  const { entries } = buildTranscriptEntries(latestMessages.value);
  const items: AssistantActivityItem[] = [];
  for (const entry of entries) {
    if (entry.kind === "assistant-turn") {
      for (const part of entry.parts) {
        if (part.kind === "activity") {
          items.push(...part.items);
        }
      }
    }
  }
  return items;
});

// All subagents invoked across the session (deduplicated by delegationId, keeping latest instance)
const turnDelegationItems = computed<DelegationActivityItem[]>(() => {
  const items = allSessionActivityItems.value.filter(isDelegationActivityItem);
  const map = new Map<string, DelegationActivityItem>();
  for (const item of items) {
    const id = delegationIdForMessage(item.message);
    map.set(id, item);
  }
  return Array.from(map.values());
});

const delegationStatuses = computed(() =>
  collectDelegationStatuses(allSessionActivityItems.value, {
    turnLive: isRunning.value,
  }),
);

const delegationTimings = computed(() =>
  collectDelegationTimings(allSessionActivityItems.value),
);

const delegationFailures = computed(() =>
  collectDelegationFailures(allSessionActivityItems.value),
);

/** Detect whether PlanStatusCapsule is currently visible in this session */
const hasPlanCapsule = computed(() => {
  if (!targetSessionId.value) return false;
  const p = store.appState?.planCheckpoints[targetSessionId.value];
  if (!p) return false;
  return (
    p.status === "pending" ||
    p.executionState === "running" ||
    p.executionState === "queued" ||
    p.executionState === "completed"
  );
});

// Network failure / rate limit pattern (accurate network & HTTP 429/5xx faults, excluding benign generic words)
const NETWORK_OR_WAITING_PATTERN =
  /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|ENETUNREACH|EHOSTUNREACH|UND_ERR|fetch failed|socket hang up|network error|connection error|connection refused|dns|rate_limit|rate limit|429|gateway timeout|504|bad gateway|502/i;

function isNetworkOrWaiting(
  delegationId: string,
  item: DelegationActivityItem,
  failures: ReadonlyMap<string, DelegationFailure>,
  outcome: SubagentOutcome,
): boolean {
  if (outcome === "timed_out") return true;

  const subItems = item.delegate?.items ?? [];
  if (subItems.length === 0) {
    const failure = failures.get(delegationId);
    if (failure) {
      if (
        NETWORK_OR_WAITING_PATTERN.test(failure.message) ||
        NETWORK_OR_WAITING_PATTERN.test(failure.code)
      ) {
        return true;
      }
    }
    if (item.message.error) {
      const errText = item.message.error.message || item.message.error.code || "";
      if (NETWORK_OR_WAITING_PATTERN.test(errText)) return true;
    }
    return false;
  }

  // Look ONLY at the latest activity in the subagent's execution so recovery is immediate
  const last = subItems[subItems.length - 1];

  // If the latest activity is thinking or text generation, it has recovered and is working
  if (last.kind === "thinking" || last.kind === "answer") {
    return false;
  }

  // If the latest activity is a tool:
  if (last.kind === "tool") {
    // If the tool is actively executing (toolStatus === 'running'), it is actively working, not waiting!
    if (last.message.toolStatus === "running") {
      return false;
    }

    // Only if the latest tool completed with a network or rate-limit error is it actively waiting for retry
    if (last.message.error) {
      const errText = last.message.error.message || last.message.error.code || "";
      if (NETWORK_OR_WAITING_PATTERN.test(errText)) return true;
    }

    const payload = toolResultPayload(last.message);
    if (typeof payload === "string" && NETWORK_OR_WAITING_PATTERN.test(payload)) {
      return true;
    }
    if (payload && typeof payload === "object") {
      const err = (payload as { error?: unknown }).error;
      if (typeof err === "string" && NETWORK_OR_WAITING_PATTERN.test(err)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Real-time concise behavior mapping:
 * - 运行 (Running): command / shell execution
 * - 读取 (Reading): read / grep / search / list / fetch
 * - 写入 (Writing): write / edit files
 * - 思考 (Thinking): reasoning / model generation
 * - 等待 (Waiting): network error / timeout / retry
 * - 已完成 (Completed): settled
 */
function resolveSubagentAction(
  item: DelegationActivityItem,
  isDone: boolean,
  isWaiting: boolean,
): { actionText: string; actionKey: "run" | "read" | "thinking" | "write" | "waiting" | "done" } {
  if (isDone) {
    return { actionText: t("chat.toolCompleted"), actionKey: "done" };
  }
  if (isWaiting) {
    return { actionText: t("chat.subagentActionWaiting"), actionKey: "waiting" };
  }

  const subItems = item.delegate?.items ?? [];
  if (subItems.length === 0) {
    return { actionText: t("chat.subagentActionThinking"), actionKey: "thinking" };
  }

  const last = subItems[subItems.length - 1];
  if (last.kind === "tool") {
    const action = getToolAction(last.message.toolName);
    if (action === "read" || action === "list" || action === "search" || action === "fetch") {
      return { actionText: t("chat.subagentActionRead"), actionKey: "read" };
    }
    if (action === "write" || action === "edit") {
      return { actionText: t("chat.subagentActionWrite"), actionKey: "write" };
    }
    return { actionText: t("chat.subagentActionRun"), actionKey: "run" };
  }

  return { actionText: t("chat.subagentActionThinking"), actionKey: "thinking" };
}

const isZh = computed(() => Boolean(locale.value?.startsWith("zh")));

// Direct scroll tracking on .thread-scroll as a fallback for history browsing detection
const scrollerScrolledUp = ref(false);

function onTranscriptScroll() {
  const el = document.querySelector(".thread-scroll");
  if (!el) return;
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
  scrollerScrolledUp.value = dist > 40;
}

let scrollEl: Element | null = null;
watch(
  targetSessionId,
  () => {
    if (scrollEl) {
      scrollEl.removeEventListener("scroll", onTranscriptScroll);
      scrollEl = null;
    }
    setTimeout(() => {
      scrollEl = document.querySelector(".thread-scroll");
      if (scrollEl) {
        scrollEl.addEventListener("scroll", onTranscriptScroll, { passive: true });
        onTranscriptScroll();
      }
    }, 100);
  },
  { immediate: true },
);

onScopeDispose(() => {
  if (scrollEl) {
    scrollEl.removeEventListener("scroll", onTranscriptScroll);
    scrollEl = null;
  }
});

const isBrowsingHistoryEffective = computed(() => {
  return Boolean(props.isBrowsingHistory || scrollerScrolledUp.value);
});

// Lifecycle and fade-out tracking for completed subagents
interface SettledRecord {
  settledAt: number;
}

const settledMap = ref<Map<string, SettledRecord>>(new Map());
// Only subagents actively observed running during live execution in this session
// are candidates for completion fadeout
const knownRunningIds = ref<Set<string>>(new Set());
const pruneTrigger = ref(0);

// Global live clock for elapsed timer
const now = ref(Date.now());
let timer = 0;

function startTimer() {
  if (!timer) {
    timer = window.setInterval(() => {
      now.value = Date.now();
    }, 1000);
  }
}

function stopTimer() {
  if (timer) {
    window.clearInterval(timer);
    timer = 0;
  }
}

watch(
  [turnDelegationItems, delegationStatuses, isRunning, isAgentMode],
  ([items, statuses, running, agentMode]) => {
    if (!agentMode) {
      settledMap.value.clear();
      knownRunningIds.value.clear();
      stopTimer();
      return;
    }

    const currentMap = new Map(settledMap.value);
    const runningSet = new Set(knownRunningIds.value);
    let hasRunning = false;

    for (const item of items) {
      const id = delegationIdForMessage(item.message);
      const outcome = statuses.get(id) ?? subagentOutcome(item.message, statuses);
      const isSettled = !running || outcome !== "running";

      if (!isSettled) {
        hasRunning = true;
        runningSet.add(id);
        currentMap.delete(id);
      } else {
        // Only trigger fade-out for subagents that were ACTIVELY observed running
        // during live execution in this active session
        if (runningSet.has(id)) {
          if (!currentMap.has(id)) {
            currentMap.set(id, { settledAt: Date.now() });
            window.setTimeout(() => {
              pruneTrigger.value++;
            }, 1450);
          }
          runningSet.delete(id);
        }
      }
    }

    settledMap.value = currentMap;
    knownRunningIds.value = runningSet;

    if (hasRunning) {
      startTimer();
    } else if (items.length === 0) {
      stopTimer();
    }
  },
  { immediate: true, deep: true },
);

onScopeDispose(() => {
  stopTimer();
});

export interface SubagentCapsuleItem {
  id: string;
  name: string;
  roleLabel: string;
  taskName: string;
  rawTask: string;
  action: string;
  actionKey: "run" | "read" | "thinking" | "write" | "waiting" | "done";
  isDone: boolean;
  isWaiting: boolean;
  elapsed: number;
}

/**
 * Active subagents to display.
 * Automatically handles multi-agent layout and 1.4s fadeout.
 * When browsing history or when session is not running, completed subagents are suppressed.
 */
const activeSubagents = computed<SubagentCapsuleItem[]>(() => {
  // Prune trigger dependency for reactivity
  void pruneTrigger.value;

  if (!isAgentMode.value) return [];

  const currentTime = now.value;
  const items = turnDelegationItems.value;
  const statuses = delegationStatuses.value;
  const timings = delegationTimings.value;
  const failures = delegationFailures.value;
  const running = isRunning.value;

  const result: SubagentCapsuleItem[] = [];

  for (const item of items) {
    const id = delegationIdForMessage(item.message);
    const outcome = statuses.get(id) ?? subagentOutcome(item.message, statuses);
    const settled = settledMap.value.get(id);

    const isSettled = !running || outcome !== "running";

    if (isSettled) {
      // 1. When browsing history (scrolling up / reading older window), completed subagents must NOT be displayed
      if (isBrowsingHistoryEffective.value) {
        continue;
      }
      // 2. When the turn is not actively running, completed subagents must NOT be displayed
      if (!running) {
        continue;
      }
      // 3. Only subagents with an active recent completion fadeout (< 1.4s) can be shown
      if (!settled) {
        continue;
      }
      if (currentTime - settled.settledAt >= 1400) {
        continue;
      }
    }

    const isWaiting = isNetworkOrWaiting(id, item, failures, outcome);
    const isDone = isSettled && !isWaiting;

    // Never display completed subagents while browsing history
    if (isBrowsingHistoryEffective.value && isDone) {
      continue;
    }

    const { actionText, actionKey } = resolveSubagentAction(item, isDone, isWaiting);
    const rawRole = delegateAgentName(item.message, item.delegate);
    const roleLabel = localizeAgentName(rawRole, isZh.value) || (isZh.value ? "探索" : "Explore");
    const rawTask = extractSubagentTaskName(item.message);
    let taskName = rawTask.replace(/\s+/g, " ").trim();

    // Strip duplicate leading role name
    if (taskName.startsWith(`${roleLabel}:`) || taskName.startsWith(`${roleLabel}：`)) {
      taskName = taskName.slice(roleLabel.length + 1).trim();
    } else if (taskName.startsWith(roleLabel) && taskName.length > roleLabel.length) {
      taskName = taskName.slice(roleLabel.length).replace(/^[:：\s]+/, "").trim();
    }
    if (rawRole) {
      if (taskName.startsWith(`${rawRole}:`) || taskName.startsWith(`${rawRole}：`)) {
        taskName = taskName.slice(rawRole.length + 1).trim();
      } else if (taskName.toLowerCase().startsWith(rawRole.toLowerCase()) && taskName.length > rawRole.length) {
        taskName = taskName.slice(rawRole.length).replace(/^[:：\s]+/, "").trim();
      }
    }

    const colon = isZh.value ? "：" : ": ";
    const name = taskName ? `${roleLabel}${colon}${taskName}` : roleLabel;

    const timing = timings.get(id);
    const start = timing?.startedAt ?? (item.message.createdAt ? new Date(item.message.createdAt).getTime() : 0);
    let elapsed = 0;
    if (start) {
      const end = timing?.completedAt ?? currentTime;
      elapsed = Math.max(0, Math.floor((end - start) / 1000));
    }

    result.push({
      id,
      name,
      roleLabel,
      taskName,
      rawTask,
      action: actionText,
      actionKey,
      isDone,
      isWaiting,
      elapsed,
    });
  }

  return result;
});

/**
 * Click to view subagent execution process in the sidebar (WorkPanel)
 * and smoothly scroll the chat transcript to the latest turn.
 */
function handleSubagentClick(delegationId: string) {
  store.appState?.toggleSubagentPanel(delegationId);

  if (targetSessionId.value) {
    store.appState?.returnToLatestTranscript(targetSessionId.value);
  }
  const scroller = document.querySelector(".thread-scroll");
  if (scroller) {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }
}

function handleAbort(event: MouseEvent) {
  event.stopPropagation();
  void store.appState?.abort();
}
</script>

<template>
  <TransitionGroup
    v-if="isAgentMode && activeSubagents.length > 0"
    tag="div"
    name="capsule-slide"
    class="agent-status-bar no-drag"
    :class="{ 'has-plan-capsule': hasPlanCapsule }"
  >
    <div
      v-for="sub in activeSubagents"
      :key="sub.id"
      class="agent-status-capsule no-drag"
      :class="{
        'is-running': !sub.isDone,
        'is-completed': sub.isDone,
      }"
      role="status"
      :aria-label="`${sub.name} · ${sub.action}`"
      :title="sub.rawTask ? `${sub.name} (${sub.rawTask})` : t('chat.viewExecutionInSidebar')"
      @click="handleSubagentClick(sub.id)"
    >
      <span class="capsule-icon-wrap" aria-hidden="true">
        <IconCheck v-if="sub.isDone" :size="13" />
        <IconClock v-else-if="sub.isWaiting" :size="13" />
        <IconArrowRight v-else :size="13" />
      </span>

      <div class="capsule-text-wrap">
        <span class="capsule-agent-name">
          <span class="capsule-agent-role">{{ sub.roleLabel }}{{ sub.taskName ? (isZh ? '：' : ': ') : '' }}</span>
          <span v-if="sub.taskName" class="capsule-task-name">{{ sub.taskName }}</span>
        </span>
        <span class="capsule-separator">·</span>
        <span
          class="capsule-agent-action"
          :class="{
            'is-waiting': sub.isWaiting,
            'is-done': sub.isDone,
          }"
        >
          {{ sub.action }}
        </span>
      </div>

      <div class="capsule-action-wrap">
        <span v-if="sub.elapsed > 0 && !sub.isDone" class="capsule-timer">
          {{ formatToolDuration(sub.elapsed) }}
        </span>
        <button
          v-if="!sub.isDone"
          type="button"
          class="capsule-stop-btn"
          :title="t('chat.stopGenerating')"
          :aria-label="t('chat.stopGenerating')"
          @click="handleAbort"
        >
          <IconStop :size="10" />
        </button>
      </div>
    </div>
  </TransitionGroup>
</template>
