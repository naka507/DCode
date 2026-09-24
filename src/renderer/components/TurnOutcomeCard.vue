<script setup lang="ts">
/**
 * "This task needs attention" card at the tail of a failed turn.
 *
 * The `TurnOutcomeCard` component.
 *
 * Two implementation notes:
 *
 *  1. **The three early returns are one `v-if` on the computed `visible`.** A
 *     Vue template cannot return early, so the three `return null`
 *     gates (`!result || completed`, an inline error in the turn tail, and a
 *     turn with nothing visible) become a single `computed` that evaluates them
 *     in the original order, and the `<section>` is `v-if`-gated on it.
 *  2. `latestTurnMessages` and the tail counts are copied verbatim.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { UiMessage } from "@dcode/shared";
import type { AgentTurnResult } from "../stores/app-store";
import { useAppStore } from "../stores/app-store";
import { IconCircleAlert } from "../lib/icons";

const props = defineProps<{
  messages: UiMessage[];
  result?: AgentTurnResult;
}>();

const { t } = useI18n();
const store = useAppStore();

function latestTurnMessages(messages: UiMessage[]) {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return lastUserIndex < 0 ? messages : messages.slice(lastUserIndex + 1);
}

/** The turn tail, empty when the card renders nothing at all. */
const tail = computed(() => {
  if (!props.result || props.result.status === "completed") return [];
  const messages = latestTurnMessages(props.messages);
  if (messages.some((message) => Boolean(message.error))) return [];
  return messages;
});

const toolCount = computed(
  () => tail.value.filter((message) => message.role === "tool").length,
);

const visible = computed(
  () =>
    tail.value.some(
      (message) =>
        Boolean(message.content.trim()) ||
        message.role === "tool" ||
        Boolean(message.error),
    ),
);

function continueTurn() {
  void store.appState?.sendPrompt(t("chat.continueUnfinishedTaskPrompt"));
}
</script>

<template>
  <section
    v-if="visible"
    class="turn-outcome-card failed"
    data-testid="turn-outcome-card"
    data-outcome="failed"
    role="status"
    aria-live="polite"
  >
    <div class="turn-outcome-heading">
      <span class="turn-outcome-icon" aria-hidden="true">
        <IconCircleAlert :size="16" />
      </span>
      <div class="turn-outcome-copy">
        <strong>{{ t("chat.resultNeedsAttention") }}</strong>
        <span>{{ t("chat.resultFailedBody") }}</span>
      </div>
    </div>
    <div v-if="toolCount > 0" class="turn-outcome-stats">
      <span>{{ t("chat.resultSteps", { count: toolCount }) }}</span>
    </div>
    <div class="turn-outcome-actions">
      <button
        type="button"
        class="copy-btn primary"
        @click="continueTurn"
      >
        {{ t("chat.resultContinue") }}
      </button>
    </div>
  </section>
</template>
