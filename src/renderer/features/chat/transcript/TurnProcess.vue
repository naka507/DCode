<script setup lang="ts">
/**
 * The disclosure that owns one assistant turn's process rows: a header with the
 * live elapsed time, the step count and the failure glyph, and a body holding
 * the rows themselves.
 *
 * The `TurnProcess` component.
 *
 * `useState(Date.now)` becomes `ref(Date.now())` (the lazy
 * initializer form), the interval effect a
 * `watch` on `isActive` plus `onMounted`/`onScopeDispose` for its install and
 * teardown, every render-derived value a `computed`, and the children prop the
 * default slot. `useId()` is Vue's own, exactly as the sibling
 * `AssistantErrorMessage.vue` uses it.
 *
 * The bare `aria-hidden` attributes are written as
 * `aria-hidden="true"` here: a bare attribute in a Vue template renders as
 * `""`, so the value is spelled out.
 *
 * `useAutomaticDisclosure` returns a plain object holding refs, so its members
 * are destructured at the top of the setup. That is what makes them
 * auto-unwrapped in the template — and why no `.value` appears there.
 */
import { computed, onMounted, onScopeDispose, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AssistantTurnPart } from "../../../lib/assistant-turns";
import { formatToolDuration } from "../../../lib/tool-display";
import { useTranscriptSearchTarget } from "../../../lib/transcript-search-context";
import {
  hasFailedProcessTool,
  isTurnThinking,
  processContainsMessage,
  resolveThinkingDisplayMode,
  shouldAutoOpenTurnProcess,
  turnProcessTiming,
  visibleProcessSteps,
} from "../../../lib/turn-process";
import { useAppStore } from "../../../stores/app-store";
import {
  IconChevronRight,
  IconCircleAlert,
  IconSparkles,
} from "../../../lib/icons";
import { useAutomaticDisclosure } from "./shared";
import DisclosureCollapseRail from "./DisclosureCollapseRail.vue";

const props = defineProps<{
  processParts: readonly AssistantTurnPart[];
  turnParts: readonly AssistantTurnPart[];
  isActive: boolean;
}>();

const { t } = useI18n();
const store = useAppStore();
const mode = computed(() =>
  resolveThinkingDisplayMode(store.appState?.settings?.thinkingDisplayMode),
);
const search = useTranscriptSearchTarget();
const revealRequest = computed(() =>
  search && processContainsMessage(props.processParts, search.messageId)
    ? search.requestId
    : undefined,
);
const hasToolFailure = computed(() => hasFailedProcessTool(props.processParts));
const thinkingNow = computed(() =>
  isTurnThinking(props.turnParts, props.isActive),
);
const { open, toggle, collapse, claim, titleRef } = useAutomaticDisclosure(
  computed(() =>
    shouldAutoOpenTurnProcess(
      mode.value,
      props.isActive,
      hasToolFailure.value,
    ),
  ),
  revealRequest,
);
const detailsId = useId();

const now = ref(Date.now());
// A `computed`, not a one-off call: the timing is re-derived on every
// render, so a part that arrived with a later timestamp moves both bounds.
const timing = computed(() => turnProcessTiming(props.turnParts));
let timer = 0;
function stopClock() {
  window.clearInterval(timer);
  timer = 0;
}
/** The effect body; its inactive path leaves no timer to clean up. */
function syncClock() {
  stopClock();
  if (!props.isActive) return;
  now.value = Date.now();
  timer = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
}
onMounted(syncClock);
watch(() => props.isActive, syncClock);
onScopeDispose(stopClock);

const count = computed(() =>
  visibleProcessSteps(props.processParts, mode.value, props.isActive),
);
const seconds = computed(() => {
  const { startedAt, endedAt } = timing.value;
  return startedAt === undefined
    ? 0
    : Math.max(
        0,
        Math.floor(
          ((props.isActive ? now.value : (endedAt ?? startedAt)) - startedAt) /
            1000,
        ),
      );
});
</script>

<template>
  <section
    v-if="count > 0"
    class="turn-process"
    :class="{ open, active: props.isActive }"
  >
    <button
      ref="titleRef"
      type="button"
      class="tool-activity-header"
      :aria-expanded="open"
      :aria-controls="detailsId"
      @click="toggle"
    >
      <span class="tool-activity-icon" aria-hidden="true">
        <IconSparkles :size="14" />
      </span>
      <span class="tool-activity-label" :class="{ running: props.isActive }">
        {{
          t(
            props.isActive
              ? thinkingNow
                ? "chat.thinkingFor"
                : "chat.processingFor"
              : "chat.processedFor",
            { time: formatToolDuration(seconds) },
          )
        }}
      </span>
      <span
        v-if="hasToolFailure"
        class="turn-process-error"
        :title="t('chat.toolFailed')"
      >
        <IconCircleAlert :size="14" :aria-label="t('chat.toolFailed')" />
      </span>
      <span class="tool-activity-count">
        {{ t("chat.processingSteps", { count }) }}
      </span>
      <span class="tool-activity-caret" aria-hidden="true">
        <IconChevronRight :size="12" />
      </span>
    </button>
    <div
      :id="detailsId"
      class="turn-process-body"
      :hidden="!open"
      :inert="!open"
      @click.capture="claim"
    >
      <DisclosureCollapseRail
        :label="t('chat.collapseDetails')"
        :on-collapse="collapse"
      />
      <slot />
    </div>
  </section>
</template>
