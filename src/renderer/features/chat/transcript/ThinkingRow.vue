<script setup lang="ts">
/**
 * One assistant reasoning segment: a disclosure whose header shows the latest
 * thought line and whose body renders the whole reasoning as markdown.
 *
 * The `ThinkingRow` component. It is the last piece of the transcript
 * cluster's component set; the two call sites that render it (`ToolRow`'s
 * delegate rows and `ActivityGroup`) are what made it load-bearing.
 *
 * The decisions that are not mechanical:
 *
 *  1. **The early return is two gated roots.** A template cannot return early,
 *     so the compact branch — which renders the pill only while the
 *     thought is still streaming, and nothing at all otherwise — is
 *     `v-if="compact && active"`, and the detailed branch that follows it is
 *     `v-else-if="!compact"`. `useAutomaticDisclosure` is still installed
 *     unconditionally, before either branch.
 *  2. **`onUserInteraction` is the `user-interaction` emit**, the shape
 *     `HostedSearchRow.vue` and `ToolRow.vue` use: the only caller
 *     (`ActivityGroup`) passes `claimDisclosure`.
 *  3. **`aria-hidden="true"` is explicit.** A bare
 *     `aria-hidden` on the two glyph wrappers renders as `""` in a Vue
 *     template.
 *  4. **`memo` and its comparator are gone** — a Vue component re-renders only
 *     when a value its render reads changes.
 */
import { computed, useId } from "vue";
import { useI18n } from "vue-i18n";
import type { UiMessage } from "@dcode/shared";
import { messageThinking } from "../../../lib/assistant-turns";
import { isThinkingActive, resolveThinkingDisplayMode } from "../../../lib/turn-process";
import { IconChevronRight, IconSparkles } from "../../../lib/icons";
import { useAppStore } from "../../../stores/app-store";
import Markdown from "../../../components/Markdown.vue";
import DisclosureCollapseRail from "./DisclosureCollapseRail.vue";
import { useAutomaticDisclosure } from "./shared";

const props = withDefaults(
  defineProps<{
    message: UiMessage;
    streaming: boolean;
    autoOpen?: boolean;
  }>(),
  { autoOpen: false },
);

const emit = defineEmits<{ "user-interaction": [] }>();

const { t } = useI18n();
const detailsId = useId();
const store = useAppStore();

const compact = computed(
  () =>
    resolveThinkingDisplayMode(store.appState?.settings?.thinkingDisplayMode) ===
    "compact",
);
/** Whether the segment is still streaming. */
const active = computed(() => isThinkingActive(props.message, props.streaming));

const { open, toggle, collapse, titleRef } = useAutomaticDisclosure(
  () => props.autoOpen,
);

function toggleRow(): void {
  emit("user-interaction");
  toggle();
}

function collapseRow(): void {
  emit("user-interaction");
  collapse();
}

const text = computed(() => messageThinking(props.message));
/** One line for the collapsed header: the whitespace is collapsed. */
const summary = computed(() => text.value.replace(/\s+/g, " ").trim());
</script>

<template>
  <div
    v-if="compact && active"
    class="tool-row thinking thinking-compact"
    role="status"
  >
    <span class="tool-row-icon" aria-hidden="true">
      <IconSparkles :size="15" />
    </span>
    <span class="tool-row-name running">{{ t("chat.thinking") }}</span>
  </div>

  <div v-else-if="!compact" class="tool-row thinking" :class="{ open }">
    <button
      ref="titleRef"
      type="button"
      class="tool-row-header"
      :aria-expanded="open"
      :aria-controls="detailsId"
      :aria-label="t(open ? 'chat.thinkingHide' : 'chat.thinkingShow')"
      @click="toggleRow"
    >
      <span class="tool-row-icon">
        <IconSparkles :size="15" aria-hidden="true" />
      </span>
      <span class="tool-row-name" :class="{ running: props.streaming }">
        {{ t("chat.thinking") }}
      </span>
      <span class="tool-row-summary">{{ summary }}</span>
      <span class="tool-row-caret" aria-hidden="true">
        <IconChevronRight :size="12" />
      </span>
    </button>
    <div v-if="open" :id="detailsId" class="tool-row-body">
      <DisclosureCollapseRail
        :label="t('chat.thinkingHide')"
        :on-collapse="collapseRow"
      />
      <div class="prose-chat thinking-prose">
        <Markdown :source="text" :render-diagrams="false" />
      </div>
    </div>
  </div>
</template>
