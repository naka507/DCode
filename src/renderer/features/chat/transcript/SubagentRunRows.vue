<script setup lang="ts">
/**
 * What a delegate did, nested under the `Task` call that spawned it.
 *
 * The `SubagentRunRows` component and its `SubagentRunFollow` helper. The two were
 * one module-private pair; the rows are the delegate's context, not the
 * parent's, so they are visibly one level in and stay collapsed with the call.
 * Only one level is possible: a delegate has no `Task` tool of its own
 * (ADR 0062).
 *
 * The decisions that are not mechanical:
 *
 * 1. **The layout effect is a `watch(., { flush: "post" })`.** A follow frame is
 *     scheduled whenever the item list or `scrollable` changes.
 * The hook is installed here rather than in a nested component (the
 *     `SubagentRunFollow` helper existed only so one function could return two elements),
 *     so its mount pin runs against an empty scroller when
 *     the run has no rows yet; the `items` watcher below is what pins the real
 *     one, and it fires after the DOM update that mounts it. `flush: "post"`
 *     keeps the follow from moving the transcript for a painted frame.
 *  2. **`DisclosureAnchorContext.Provider` is `provideDisclosureAnchorNotifier`,
 * called once at the top.** Only the follow scroller is wrapped; the
 *     rail and the heading inject nothing, so widening the scope changes no
 *     behaviour while removing the extra wrapper element the template cannot
 *     express.
 *  3. **`<Fragment key>` is `<template v-for :key>`.** The three row kinds
 * render as siblings, exactly as one fragment would — the tool
 *     branch is a `Task` row plus its `ReviewChangeCard`, the thinking branch a
 *     `ThinkingRow`, the answer branch the `subagent-answer` div.
 *  4. **`aria-hidden="true"` is explicit** on the heading's bot glyph: a bare
 *     attribute in a Vue template renders as `""`, so the explicit value is written.
 *  5. A component re-renders only when its reactive dependencies change, and the
 *     dock variant's `scrollable={false}` / `variant="dock"` props keep their names.
 */
import { computed, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { SubagentRun, SubagentRunItem } from "../../../lib/assistant-turns";
import { provideDisclosureAnchorNotifier } from "../../../lib/disclosure-anchor-context";
import { IconArrowDown, IconBot } from "../../../lib/icons";
import { useFollowScroll } from "../../../hooks/use-follow-scroll";
import TooltipButton from "../../../components/TooltipButton.vue";
import Markdown from "../../../components/Markdown.vue";
import ReviewChangeCard from "../../../components/ReviewChangeCard.vue";
import AssistantErrorMessage from "./AssistantErrorMessage.vue";
import DisclosureCollapseRail from "./DisclosureCollapseRail.vue";
import ThinkingRow from "./ThinkingRow.vue";
import ToolRow from "./ToolRow.vue";

const props = withDefaults(
  defineProps<{
    run: SubagentRun;
    agentName: string;
    onCollapse?: () => void;
    /** Side-panel mode lets the parent panel own the only scrollbar. */
    scrollable?: boolean;
    /** Dock headings are section labels; inline headings name the delegate. */
    variant?: "inline" | "dock";
  }>(),
  { onCollapse: undefined, scrollable: true, variant: "inline" },
);

const { t } = useI18n();
const headingId = useId();

const items = computed(() => props.run.items);
const dock = computed(() => props.variant === "dock");
/** The `if (run.items.length === 0) return null;` gates the whole card. */
const visible = computed(() => items.value.length > 0);

const {
  scrollRef,
  contentRef,
  showJump,
  handleScroll,
  jumpToLatest,
  scheduleFollowScroll,
  disclosureAnchorNotifier,
} = useFollowScroll();

provideDisclosureAnchorNotifier(disclosureAnchorNotifier);

/** The `useLayoutEffect`: only a scrollable run schedules a follow. */
watch(
  items,
  () => {
    if (!props.scrollable) return;
    scheduleFollowScroll();
  },
  { flush: "post" },
);

/** The `dock ? t("chat.subagentProcess") : …` heading text. */
const headingText = computed(() =>
  dock.value
    ? t("chat.subagentProcess")
    : props.agentName
      ? t("chat.subagentWork", { agent: props.agentName })
      : t("chat.subagentWorkUnnamed"),
);

function onScroll(): void {
  if (props.scrollable) handleScroll();
}

function rowStreaming(item: SubagentRunItem): boolean {
  return item.message.status === "streaming";
}
</script>

<template>
  <div v-if="visible" class="subagent-run" :class="{ 'is-dock': dock }">
    <DisclosureCollapseRail
      v-if="props.onCollapse"
      :label="t('chat.collapseDetails')"
      :on-collapse="props.onCollapse"
    />
    <div
      :id="headingId"
      class="subagent-run-heading"
      :class="{ 'is-dock': dock }"
    >
      <IconBot v-if="!dock" :size="13" aria-hidden="true" />
      <span>{{ headingText }}</span>
      <span class="subagent-run-count">
        {{ t("chat.processingSteps", { count: items.length }) }}
      </span>
    </div>

    <div class="subagent-run-follow">
      <!--
        The rows scroll inside the run rather than growing the transcript
        (D271). Follow sticks to the latest output while pinned (D302).
        Labelled and focusable so a keyboard reader can reach the scroll area
        the pointer can already use.
      -->
      <div
        ref="scrollRef"
        data-scroll-owner="follow"
        class="subagent-run-rows"
        :class="{ 'is-panel-flow': !props.scrollable }"
        role="group"
        :tabindex="props.scrollable ? 0 : undefined"
        :aria-labelledby="headingId"
        @scroll="onScroll"
      >
        <div ref="contentRef">
          <template v-for="item in items" :key="item.message.id">
            <template v-if="item.kind === 'tool'">
              <ToolRow :message="item.message" />
              <ReviewChangeCard :message="item.message" />
            </template>
            <ThinkingRow
              v-else-if="item.kind === 'thinking'"
              :message="item.message"
              :streaming="rowStreaming(item)"
            />
            <div
              v-else
              class="subagent-answer"
              :data-message-id="item.message.id"
            >
              <div v-if="item.message.content" class="prose-chat">
                <Markdown :source="item.message.content" />
              </div>
              <AssistantErrorMessage
                v-if="item.message.error"
                :message="item.message"
              />
            </div>
          </template>
        </div>
      </div>
      <TooltipButton
        v-if="props.scrollable && showJump"
        type="button"
        class="jump-latest-btn"
        :aria-label="t('chat.scrollToBottom')"
        :label="t('chat.scrollToBottom')"
        @click="jumpToLatest"
      >
        <IconArrowDown :size="14" />
      </TooltipButton>
    </div>
  </div>
</template>
