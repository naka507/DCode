<script setup lang="ts">
/**
 * Composer context-usage ring and its token-breakdown popover.
 *
 * The `ContextUsageInspector` component. Every figure it shows is
 * derived by `lib/context-usage.ts`, and the
 * placement arithmetic is `lib/context-inspector-position.ts`.
 *
 * The decisions that are not mechanical:
 *
 *  1. **`createPortal(popover, document.body)` is `<Teleport to="body">`.** The
 *     `#dcode-overlays` host (`lib/overlay-root.ts`) is a `z-index: 40`
 *     stacking context with `pointer-events: none` for anything that is not a
 *     direct `.overlay` child, so a popover parked there would be confined
 *     below the body-level layers it is meant to float over
 *     (`.context-inspector-popover` carries `z-index: 60` in
 *     `styles/messages.css`). `Sidebar.vue` and `NotificationCenter.vue` are
 *     the other two body portals in this tree and reached the same conclusion;
 *     `overlayRoot()` is the target for the `.overlay` dialog family.
 *  2. **The trigger element is reached through the root `querySelector`,** the
 *     idiom `NotificationCenter.vue` documents: the shared `TooltipButton.vue`
 *     renders its anchor plus a teleported label from a fragment root, so a
 *     template ref yields the fragment's text anchor rather than the
 * `<button class="context-inspector-trigger">`. This component holds a plain
 *     `useRef<HTMLButtonElement>`.
 *  3. **The effects become watchers on what they measured, post-flush.**
 * the `useLayoutEffect`/`useEffect`s ran after the commit, when the
 *     popover was in the DOM and measurable; a default (pre) Vue watcher would
 *     run before the popover is inserted, so the placement watcher is
 *     `flush: "post"` and still schedules its read on the next frame exactly as
 * the placement watcher does. The listener/observer effects keep the `open` guard
 *     as their watcher dependency and register through `onCleanup`.
 *  4. **`popoverPosition` is the `is-open` gate,** so the measured-before-shown
 *     contract is unchanged: `updatePopoverPosition` bails on a hidden or
 *     out-of-view trigger, and the popover only fades in once a placement
 *     exists.
 *  5. The i18n calls lose i18next's inline `defaultValue` fallbacks (the keys
 *     ship in both catalogs) and keep every interpolation argument verbatim.
 */
import { computed, onUnmounted, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  formatCompactTokenCount,
  type MessageUsage,
  type UiMessage,
} from "@dcode/shared";
import { useAppStore } from "../stores/app-store";
import TooltipButton from "./TooltipButton.vue";
import {
  aggregateToolTokenUsage,
  calculateCacheRate,
  calculateContextBreakdown,
  calculateContextUsage,
  calculateTokenRate,
  contextOccupancyTokens,
  contextUsageView,
  formatContextCapacityTokens,
  resolveContextUsageDisplay,
} from "../lib/context-usage";
import {
  placeContextInspector,
  type ContextInspectorPlacement,
} from "../lib/context-inspector-position";

const CONTEXT_RING_RADIUS = 9;
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS;

const props = withDefaults(
  defineProps<{
    usage: MessageUsage;
    turnUsage: MessageUsage;
    contextWindow: number;
    tools: UiMessage[];
    responseDurationMs?: number;
    responseOutputTokens?: number;
    responseOutputEstimated?: boolean;
  }>(),
  {
    responseDurationMs: undefined,
    responseOutputTokens: undefined,
    responseOutputEstimated: false,
  },
);

const { t, locale } = useI18n();

const panelId = useId();

const breakdown = computed(() =>
  calculateContextBreakdown({
    usage: props.usage,
    tools: props.tools,
  }),
);

const usedCapacityText = computed(() =>
  formatContextCapacityTokens(context.value.usedTokens, locale.value),
);
const totalCapacityText = computed(() =>
  formatContextCapacityTokens(props.contextWindow, locale.value),
);

const store = useAppStore();
/*
 * The transcript shows one row per compaction; the inspector adds what those
 * rows cannot — how much of the model context the newest summary occupies.
 */
const appState = computed(() => store.appState);
const compaction = computed(() => {
  const activeSessionId = appState.value?.activeSessionId;
  return activeSessionId
    ? appState.value?.sessionCompactions[activeSessionId]?.at(-1)
    : undefined;
});
/*
 * The display preference flips the leading figure only; capacity colors still
 * follow remaining space so the warning state keeps one meaning.
 */
const usageDisplay = computed(() =>
  resolveContextUsageDisplay(appState.value?.settings?.contextUsageDisplay),
);

const context = computed(() =>
  calculateContextUsage(props.usage, props.contextWindow),
);
const display = computed(() => contextUsageView(context.value, usageDisplay.value));
/*
 * Occupancy, turn total, and provider cache/input/output are the last model
 * request. Summing every tool-loop call inflates cache read past the window
 * (OpenCode last-message accounting).
 */
const turnTotal = computed(() => contextOccupancyTokens(props.usage));
const throughput = computed(() =>
  calculateTokenRate(
    props.responseOutputTokens ?? props.turnUsage.outputTokens,
    props.responseDurationMs,
  ),
);
const cacheRate = computed(() =>
  calculateCacheRate(props.usage.inputTokens, props.usage.cacheReadTokens),
);
const toolRows = computed(() => aggregateToolTokenUsage(props.tools));
const toolTotal = computed(() =>
  toolRows.value.reduce((total, row) => total + row.totalTokens, 0),
);
const level = computed(() =>
  context.value.remainingPercent <= 10
    ? "critical"
    : context.value.remainingPercent <= 25
      ? "warning"
      : "comfortable",
);

/**
 * The throughput figure's text, or the unavailable dash.
 *
 * The ternary is inlined here, where `throughput` is a `const` that
 * TypeScript narrows at the `formatCompactTokenCount` call site. A `computed`
 * does not survive that narrowing into the template — the same reason
 * `MessageMeta.vue` folds its guard and its formatting into one computed — so
 * both branches are resolved here with a `number` in hand.
 */
const throughputText = computed(() => {
  const rate = throughput.value;
  return rate === undefined
    ? t("chat.usageThroughputUnavailable")
    : t(
        props.responseOutputEstimated
          ? "chat.usageThroughputEstimated"
          : "chat.usageThroughput",
        { count: formatCompactTokenCount(rate) },
      );
});
/*
 * One accessible sentence serves both display modes: the localized `state`
 * phrase carries "remaining"/"used", so the key stays literal for the tooltip
 * contract while `percent`/`count` stay numeric.
 */
const ariaLabel = computed(() =>
  t("chat.usageContextAria", {
    percent: display.value.percent,
    count: formatCompactTokenCount(display.value.tokens),
    state:
      display.value.display === "used"
        ? t("chat.usageContextAriaUsed")
        : t("chat.usageContextAriaRemaining"),
  }),
);

const rootRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLDivElement | null>(null);
const open = ref(false);
const popoverPosition = ref<ContextInspectorPlacement | null>(null);

/**
 * The `<button>` the popover anchors to. See note 2: a template ref on the
 * `TooltipButton` component resolves to its fragment anchor, not to the button.
 */
function triggerEl(): HTMLButtonElement | null {
  return (
    rootRef.value?.querySelector<HTMLButtonElement>(".context-inspector-trigger") ??
    null
  );
}

let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function closeInspector(): void {
  if (openTimer) {
    clearTimeout(openTimer);
    openTimer = null;
  }
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  open.value = false;
  popoverPosition.value = null;
}

function handlePointerEnter(): void {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (!open.value && !openTimer) {
    openTimer = setTimeout(() => {
      open.value = true;
      openTimer = null;
    }, 80);
  }
}

function handlePointerLeave(): void {
  if (openTimer) {
    clearTimeout(openTimer);
    openTimer = null;
  }
  if (open.value && !closeTimer) {
    closeTimer = setTimeout(() => {
      closeInspector();
      closeTimer = null;
    }, 200);
  }
}

function toggleInspector(): void {
  if (openTimer) {
    clearTimeout(openTimer);
    openTimer = null;
  }
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (open.value) {
    closeInspector();
  } else {
    open.value = true;
  }
}

onUnmounted(() => {
  if (openTimer) clearTimeout(openTimer);
  if (closeTimer) clearTimeout(closeTimer);
});

function updatePopoverPosition(): void {
  const trigger = triggerEl();
  const popover = popoverRef.value;
  if (!trigger || !popover) return;

  const triggerRect = trigger.getBoundingClientRect();
  const triggerVisible =
    triggerRect.bottom > 0 && triggerRect.top < window.innerHeight;
  if (!triggerVisible) {
    closeInspector();
    return;
  }
  const popoverRect = popover.getBoundingClientRect();
  /*
   * Clamp against the conversation pane rather than the viewport: the pane ends
   * where the work panel begins, and the panel's native browser/plugin surfaces
   * composite above every renderer layer, so whatever part of the popover
   * crosses that edge is covered whatever z-index it carries (D357).
   */
  const paneRect = trigger.closest(".main-pane")?.getBoundingClientRect();
  const placement = placeContextInspector({
    trigger: {
      left: triggerRect.left,
      top: triggerRect.top,
      bottom: triggerRect.bottom,
    },
    popover: { width: popoverRect.width, height: popoverRect.height },
    pane: paneRect ? { left: paneRect.left, right: paneRect.right } : null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });
  if (!placement) {
    closeInspector();
    return;
  }

  const previous = popoverPosition.value;
  if (
    previous?.top === placement.top &&
    previous.left === placement.left &&
    previous.maxWidth === placement.maxWidth
  ) {
    return;
  }
  popoverPosition.value = placement;
}

/* the `useLayoutEffect`: measure on the frame after the popover exists. */
watch(
  () => [
    compaction.value,
    context.value.usedTokens,
    props.contextWindow,
    open.value,
    toolRows.value.length,
    toolTotal.value,
    turnTotal.value,
    throughput.value,
  ],
  (_current, _previous, onCleanup) => {
    if (!open.value) return;
    const frame = window.requestAnimationFrame(updatePopoverPosition);
    onCleanup(() => window.cancelAnimationFrame(frame));
  },
  { flush: "post" },
);

watch(
  open,
  (isOpen, _previous, onCleanup) => {
    if (!isOpen) return;
    const handleViewportChange = () => updatePopoverPosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    onCleanup(() => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    });
  },
  { flush: "post" },
);

watch(
  open,
  (isOpen, _previous, onCleanup) => {
    const popover = popoverRef.value;
    if (!isOpen || !popover || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updatePopoverPosition);
    observer.observe(popover);
    onCleanup(() => observer.disconnect());
  },
  { flush: "post" },
);

/*
 * Sidebar toggle/resize, work-panel open/resize, and the panel's entrance
 * animation all move the pane's right edge without emitting a window resize or
 * a scroll event (#246). A stale clamp would leave part of the popover under
 * the panel's native surfaces, so the open popover observes the pane and
 * re-runs placement whenever its box changes.
 */
watch(
  open,
  (isOpen, _previous, onCleanup) => {
    if (!isOpen || typeof ResizeObserver === "undefined") return;
    const pane = triggerEl()?.closest(".main-pane");
    if (!pane) return;
    const observer = new ResizeObserver(updatePopoverPosition);
    observer.observe(pane);
    onCleanup(() => observer.disconnect());
  },
  { flush: "post" },
);

watch(
  open,
  (isOpen, _previous, onCleanup) => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerEl()?.contains(target) || popoverRef.value?.contains(target)) {
        return;
      }
      closeInspector();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeInspector();
      triggerEl()?.focus();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    });
  },
  { flush: "post" },
);

</script>

<template>
  <div
    ref="rootRef"
    class="context-inspector"
    :data-level="level"
    :data-open="open ? 'true' : 'false'"
    @pointerenter="handlePointerEnter"
    @pointerleave="handlePointerLeave"
  >
    <TooltipButton
      type="button"
      class="context-inspector-trigger"
      :label="open ? '' : ariaLabel"
      :aria-label="ariaLabel"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="open ? panelId : undefined"
      @click="toggleInspector"
    >
      <svg
        class="context-inspector-ring"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          class="context-inspector-ring-track"
          cx="12"
          cy="12"
          :r="CONTEXT_RING_RADIUS"
        />
        <circle
          class="context-inspector-ring-progress"
          cx="12"
          cy="12"
          :r="CONTEXT_RING_RADIUS"
          :stroke-dasharray="CONTEXT_RING_CIRCUMFERENCE"
          :stroke-dashoffset="CONTEXT_RING_CIRCUMFERENCE * (1 - display.ratio)"
        />
      </svg>
      <span class="context-inspector-ring-value">{{ display.percent }}%</span>
    </TooltipButton>
    <Teleport v-if="open" to="body">
      <div
        ref="popoverRef"
        class="context-inspector-popover"
        :class="{ 'is-open': Boolean(popoverPosition) }"
        :id="panelId"
        role="dialog"
        :aria-label="t('chat.usageContextCapacity')"
        :style="
          popoverPosition
            ? {
                top: `${popoverPosition.top}px`,
                left: `${popoverPosition.left}px`,
                maxWidth: `${popoverPosition.maxWidth}px`,
              }
            : undefined
        "
        @pointerenter="handlePointerEnter"
        @pointerleave="handlePointerLeave"
      >
        <div class="context-inspector-header">
          <span class="context-inspector-title">{{ t("chat.usageContextCapacity") }}</span>
          <span class="context-inspector-stat">
            {{ usedCapacityText }}/{{ totalCapacityText }} ({{ context.usedPercent }}%)
          </span>
        </div>

        <div class="context-inspector-progress-track">
          <div
            class="context-inspector-progress-fill"
            :style="{ width: `${context.usedPercent}%` }"
          />
        </div>

        <div class="context-inspector-breakdown">
          <div
            v-for="item in breakdown"
            :key="item.key"
            class="context-breakdown-row"
          >
            <div class="context-breakdown-label">
              <span class="context-breakdown-dot" :class="item.colorClass" />
              <span>{{ t(item.labelKey) }}</span>
            </div>
            <span class="context-breakdown-percent">{{ item.formattedPercent }}</span>
          </div>
        </div>

        <hr class="context-inspector-divider" />

        <div class="context-inspector-footer">
          <span>{{ t("chat.usageAverageCacheRate") }}</span>
          <span class="context-inspector-footer-value">
            {{ cacheRate !== undefined ? `${cacheRate}%` : "—" }}
          </span>
        </div>
      </div>
    </Teleport>
  </div>
</template>
