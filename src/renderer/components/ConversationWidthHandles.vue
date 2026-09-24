<script setup lang="ts">
/**
 * Dual edge handles for the centered conversation band (D439). Both sides
 * change one preferred max-width; the live band is `min(100%, preferred)`.
 *
 * The drag arithmetic is unchanged — `chatContentWidthFromDrag` and
 * `clampChatContentMaxWidth` come from `@dcode/shared`. The decisions that are
 * not mechanical:
 *
 * 1. **The persisted width is a `computed`, not a store selector.** The width is
 *     resolved with `useAppStore((state) => resolveChatContentMaxWidth(...))`;
 *     `store.appState` is a `shallowRef`, so a `computed` over
 *     `store.appState?.settings?.chatContentMaxWidth` is the same tracked read.
 *  2. **`getState()` / `setState()` become `currentAppState()` /
 *     `patchAppState()`.** Components may not call `getState()`: it is an
 *     untracked plain call. The two module-level counterparts exist for exactly
 *     this case and are what `lib/commands.ts` already uses for its own
 *     read-then-write settings update.
 *  3. **The layout effect is a post-flush `watch` plus `onMounted`.** The effect
 *     wrote CSS custom properties onto the host's parent, which is a DOM
 *     side-effect on already-rendered markup: a pre-flush watcher would write
 *     them a render early, so this one is `flush: "post"`. `onMounted` covers
 *     the first application, when the refs are assigned but no width change has
 *     fired. Cleanup pairs become `onMounted`/`onBeforeUnmount`.
 *  4. **The per-side class and test id are precomputed in script.** The
 *     template only binds a value, because the class contract reads a backtick
 *     template in a `:class` binding as the literal fragment
 *     (`` `chat-width-handle-${side}` `` would report `chat-width-handle-`).
 *  5. **The pointer/keyboard handlers are plain functions taking the side as an
 *     argument.** A curried handler is not needed, because the template has no
 *     render-prop scope and `v-for` supplies the side here.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  DEFAULT_CHAT_CONTENT_MAX_WIDTH,
  MIN_CHAT_CONTENT_MAX_WIDTH,
  chatContentWidthFromDrag,
  clampChatContentMaxWidth,
  resolveChatContentMaxWidth,
  type ChatContentResizeSide,
} from "@dcode/shared";
import { api } from "../lib/api";
import { currentAppState, patchAppState, useAppStore } from "../stores/app-store";

type DragState = {
  pointerId: number;
  side: ChatContentResizeSide;
  startClientX: number;
  startWidth: number;
  paneWidth: number;
  currentWidth: number;
  frame: number;
};

/** The two handles, with the class and test id built per side. */
const HANDLES: {
  side: ChatContentResizeSide;
  className: string;
  testId: string;
}[] = [
  {
    side: "left",
    className: "chat-width-handle-left",
    testId: "chat-width-handle-left",
  },
  {
    side: "right",
    className: "chat-width-handle-right",
    testId: "chat-width-handle-right",
  },
];

function surfaceOf(host: HTMLDivElement | null): HTMLElement | null {
  return host?.parentElement ?? null;
}

function applyPreferredWidth(surface: HTMLElement | null, width: number) {
  if (!surface) return;
  const px = `${width}px`;
  surface.style.setProperty("--chat-content-max-width", px);
  surface.style.setProperty("--chat-composer-max-width", px);
  // The per-message prose width must track the band, otherwise the message
  // rows stay frozen at the `.main-pane` default (760px) while the band it
  // sits in widens (the bug this fixes: content no longer scales with it).
  surface.style.setProperty("--chat-prose-max-width", px);
}

function setResizing(surface: HTMLElement | null, on: boolean) {
  if (!surface) return;
  if (on) {
    surface.dataset.chatResizing = "true";
    document.documentElement.dataset.chatResizing = "true";
  } else {
    delete surface.dataset.chatResizing;
    delete document.documentElement.dataset.chatResizing;
  }
}

const { t } = useI18n();
const store = useAppStore();
const hostRef = ref<HTMLDivElement | null>(null);
let dragRef: DragState | null = null;

const persisted = computed(() =>
  resolveChatContentMaxWidth(
    store.appState?.settings?.chatContentMaxWidth,
  ),
);
const dragWidth = ref<number | null>(null);
const paneWidth = ref(0);
const width = computed(() => dragWidth.value ?? persisted.value);

function surface(): HTMLElement | null {
  return surfaceOf(hostRef.value);
}

/* The `useLayoutEffect`: publish the preferred width onto the band. */
onMounted(() => applyPreferredWidth(surface(), width.value));
watch(
  width,
  (next) => applyPreferredWidth(surface(), next),
  { flush: "post" },
);

/* The `useEffect` on mount: track the band's own width for the clamps. */
function observePane(): void {
  const el = surface();
  if (!el) return;
  const sync = () => {
    paneWidth.value = el.clientWidth;
  };
  sync();
  const observer = new ResizeObserver(sync);
  observer.observe(el);
  onBeforeUnmount(() => observer.disconnect());
}

onMounted(observePane);

/* The cleanup effect: drop the drag frame and the resizing attribute. */
onBeforeUnmount(() => {
  const drag = dragRef;
  if (drag?.frame) cancelAnimationFrame(drag.frame);
  dragRef = null;
  setResizing(surface(), false);
});

async function persistWidth(next: number): Promise<void> {
  const settings = currentAppState().settings;
  if (!settings) return;
  if (settings.chatContentMaxWidth === next) return;
  const payload = { ...settings, chatContentMaxWidth: next };
  try {
    await api.setSettings(payload);
    patchAppState({ settings: payload });
  } catch {
    /* keep the live band; the next drag can retry */
  }
}

function finishDrag(
  target: HTMLDivElement,
  pointerId: number,
  cancelled: boolean,
): void {
  const drag = dragRef;
  if (drag?.pointerId !== pointerId) return;
  if (drag.frame) cancelAnimationFrame(drag.frame);
  dragRef = null;
  if (target.hasPointerCapture(pointerId)) {
    target.releasePointerCapture(pointerId);
  }
  setResizing(surface(), false);
  const committed = cancelled ? drag.startWidth : drag.currentWidth;
  dragWidth.value = null;
  applyPreferredWidth(surface(), committed);
  if (!cancelled) void persistWidth(committed);
}

function handlePointerDown(
  event: PointerEvent,
  side: ChatContentResizeSide,
): void {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget as HTMLDivElement;
  handle.focus({ preventScroll: true });
  const el = surface();
  const livePane = el?.clientWidth ?? paneWidth.value;
  const startWidth = clampChatContentMaxWidth(width.value, livePane);
  dragRef = {
    pointerId: event.pointerId,
    side,
    startClientX: event.clientX,
    startWidth,
    paneWidth: livePane,
    currentWidth: startWidth,
    frame: 0,
  };
  dragWidth.value = startWidth;
  setResizing(el, true);
  handle.setPointerCapture(event.pointerId);
}

function handlePointerMove(event: PointerEvent): void {
  const drag = dragRef;
  if (drag?.pointerId !== event.pointerId) return;
  drag.currentWidth = chatContentWidthFromDrag({
    side: drag.side,
    startWidth: drag.startWidth,
    startClientX: drag.startClientX,
    clientX: event.clientX,
    paneWidth: drag.paneWidth,
  });
  if (drag.frame) return;
  drag.frame = requestAnimationFrame(() => {
    if (dragRef !== drag) return;
    drag.frame = 0;
    dragWidth.value = drag.currentWidth;
  });
}

function handlePointerUp(event: PointerEvent): void {
  finishDrag(event.currentTarget as HTMLDivElement, event.pointerId, false);
}

function handlePointerCancel(event: PointerEvent): void {
  finishDrag(event.currentTarget as HTMLDivElement, event.pointerId, true);
}

function handleDoubleClick(): void {
  dragWidth.value = null;
  applyPreferredWidth(surface(), DEFAULT_CHAT_CONTENT_MAX_WIDTH);
  void persistWidth(DEFAULT_CHAT_CONTENT_MAX_WIDTH);
}

function handleKeyDown(event: KeyboardEvent): void {
  const drag = dragRef;
  if (event.key === "Escape" && drag) {
    event.preventDefault();
    finishDrag(event.currentTarget as HTMLDivElement, drag.pointerId, true);
    return;
  }
  const livePane = surface()?.clientWidth ?? paneWidth.value;
  const step = event.shiftKey ? 32 : 16;
  const side = (event.currentTarget as HTMLDivElement).dataset.side;
  let next: number | null = null;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const towardWider =
      (side === "left" && event.key === "ArrowLeft") ||
      (side === "right" && event.key === "ArrowRight");
    next = width.value + (towardWider ? step : -step);
  } else if (event.key === "Home") {
    next = DEFAULT_CHAT_CONTENT_MAX_WIDTH;
  } else if (event.key === "End") {
    next = Number.POSITIVE_INFINITY;
  }
  if (next === null) return;
  event.preventDefault();
  const clamped = clampChatContentMaxWidth(next, livePane);
  applyPreferredWidth(surface(), clamped);
  void persistWidth(clamped);
}

const max = computed(() =>
  clampChatContentMaxWidth(Number.POSITIVE_INFINITY, paneWidth.value || 10_000),
);
const label = computed(() => t("nav.resizeChatWidth"));
const valueText = computed(() => t("nav.chatWidth", { width: width.value }));
const resizing = computed(() => dragWidth.value !== null);
</script>

<template>
  <div ref="hostRef" class="chat-width-handles">
    <div
      v-for="handle in HANDLES"
      :key="handle.side"
      role="separator"
      aria-orientation="vertical"
      :aria-label="label"
      :aria-valuemin="MIN_CHAT_CONTENT_MAX_WIDTH"
      :aria-valuemax="max"
      :aria-valuenow="width"
      :aria-valuetext="valueText"
      :data-side="handle.side"
      :data-testid="handle.testId"
      :tabindex="0"
      class="chat-width-handle no-drag"
      :class="[handle.className, { 'is-resizing': resizing }]"
      @pointerdown="handlePointerDown($event, handle.side)"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerCancel"
      @dblclick="handleDoubleClick"
      @keydown="handleKeyDown"
    />
  </div>
</template>
