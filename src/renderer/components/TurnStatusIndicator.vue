<script setup lang="ts">
/**
 * Turn Status Indicator (ADR-001 Phase C).
 *
 * Live turn lifecycle display, subscribed from turn events via the store's
 * `turnStates`. Shows the current phase while a turn is active
 * ("Executing tools (3)…", "Waiting for approval…") and the outcome when
 * it settles. Renders nothing when the session has no tracked turn.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { TurnPhase, TurnStatus } from "@dcode/shared";
import { useAppStore } from "../stores/app-store";
import type { TurnStateInfo } from "../stores/app-state";

const props = withDefaults(
  defineProps<{
    sessionId?: string;
  }>(),
  {
    sessionId: undefined,
  },
);

const { t } = useI18n();
const store = useAppStore();

const targetSessionId = computed(
  () => props.sessionId || store.appState?.activeSessionId,
);

const turnState = computed<TurnStateInfo | undefined>(
  () => targetSessionId.value ? store.appState?.turnStates[targetSessionId.value] : undefined,
);

const TERMINAL_STATUSES: TurnStatus[] = ["completed", "failed", "aborted"];
const isTerminal = computed(
  () => !!turnState.value && TERMINAL_STATUSES.includes(turnState.value.status),
);

const PHASE_KEYS: Record<TurnPhase, string> = {
  starting: "chat.turnPhaseStarting",
  compacting: "chat.turnPhaseCompacting",
  waiting_model: "chat.turnPhaseWaitingModel",
  executing: "chat.turnPhaseExecuting",
  delegating: "chat.turnPhaseDelegating",
  recovering: "chat.turnPhaseRecovering",
  retrying: "chat.turnPhaseRetrying",
};

const label = computed(() => {
  const state = turnState.value;
  if (!state) return "";
  switch (state.status) {
    case "awaiting_approval":
      return t("chat.turnAwaitingApproval");
    case "suspended":
      return t("chat.turnSuspended");
    case "completed":
      return t("chat.turnCompleted");
    case "failed":
      return t("chat.turnFailed");
    case "aborted":
      return t("chat.turnAborted");
    case "active":
    case "pending":
    default:
      if (state.phase === "executing" && state.toolCallCount > 0) {
        return t("chat.turnPhaseExecutingWithCount", { count: state.toolCallCount });
      }
      return t(PHASE_KEYS[state.phase]);
  }
});
</script>

<template>
  <div
    v-if="turnState"
    class="turn-status-indicator no-drag"
    :class="{ 'is-terminal': isTerminal }"
    role="status"
    :aria-label="label"
  >
    <span class="turn-status-dot" aria-hidden="true" />
    <span>{{ label }}</span>
  </div>
</template>
