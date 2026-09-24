<script setup lang="ts">
/**
 * Codex-style conversation minimap: a packed stack of dashes on the left edge
 * of the thread, one per user turn or assistant response. Moving the cursor
 * along the rail magnifies nearby dashes with a macOS-Dock cosine falloff, the
 * nearest turn shows a preview popover, and clicking jumps to that turn. Dashes
 * grow horizontally only, so magnification never shifts the stack layout.
 *
 * The `ConversationMinimap` component. The measurement, caching
 * and magnification arithmetic is unchanged; the reactive plumbing is not:
 *
 * 1. **`scrollRef` accepts a ref, a getter, or the element.** The earlier version took a
 *     `RefObject` and read `.current`. `scrollEl()` accepts all three, so the
 *     parent writes whichever form it holds. Note that a template binding does
 *     NOT hand over a setup ref: `:scroll-ref="scrollRef"` compiles to
 * `scrollRef.value`, i.e. The element (null on the first render), and only a
 *     `scrollRef.value`, i.e. the element (null on the first render), and only a
 *     object itself. `() => el` is the idiom
 *     `features/chat/transcript/shared.ts` uses for a ref-or-getter argument.
 *  2. **Marker elements are found positionally, not through ref callbacks.**
 *     Each dash is registered in a `Map` from a `ref` callback. That
 *     works for a native `<button>`, but the earlier-history dash is a
 *     `TooltipButton`, whose template has a fragment root — a template ref
 *     there yields the component instance, and its `$el` is the fragment's
 *     text anchor rather than the `<button>` that carries `.minimap-marker`.
 *     `measureMagnifyCenters` therefore reads the rail's own `<button>`
 *     children in template order (history dash first, then one per marker),
 *     which is exactly the order the callbacks inserted into its `Map`,
 *     and adds no attribute to the DOM that was not rendered before.
 * 3. **Effects became watchers on what they actually measured.** The earlier version's
 *     `useEffect`s ran after the commit, when the markers and the scroller were
 *     in the DOM; a default (pre) Vue watcher runs before the re-render and
 *     would measure the previous marker set, so every measurement watcher is
 *     `flush: "post"`. Note that `immediate` on a post-flush watcher runs its
 *     callback *during setup* (`reactivity`'s `doWatch` calls `job(true)`
 *     directly when `immediate` is set, bypassing the scheduler), so the
 *     callbacks here early-return on a missing node and do their real work on
 *     the post-flush change that follows.
 *  4. **The `activeIdRef` / `overflowsRef` guards are gone.** They existed to
 *     skip `setState` when a value had not changed; a Vue `ref` setter already
 *     compares with `Object.is`, so the guard is the framework's job now.
 * 5. **`onRevealEarlier` is the `reveal-earlier` emit.** The history dash is also
 *     disabled when no handler is passed at all;
 *     `canRevealEarlier` asks the same question of the raw vnode props, which
 *     is where the compiler puts `@reveal-earlier`.
 *  6. `loading` on the history dash is carried over verbatim from the markup;
 *     neither stylesheet ever
 *     defined `.loading` (it is allowlisted in the class contract).
 */
import {
  computed,
  getCurrentInstance,
  isRef,
  onBeforeUnmount,
  ref,
  watch,
  type Ref,
} from "vue";
import { useI18n } from "vue-i18n";
import type { UiMessage } from "@dcode/shared";
import {
  buildConversationMinimapMarkers,
  shouldRenderConversationMinimap,
  type ConversationMinimapMarker,
} from "../lib/conversation-minimap";
import TooltipButton from "./TooltipButton.vue";

/* Dock magnification: reach of the falloff and peak growth factor. */
const MAGNIFY_RADIUS = 46;
const MAGNIFY_BOOST = 1.3;
/* Cursor must be this close to a dash for the popover to pick it. */
const POPOVER_SNAP = 24;
const POPOVER_HEIGHT = 132;
/* Hide the rail until content actually overflows one viewport. */
const OVERFLOW_EPSILON_PX = 1;
const EARLIER_HISTORY_MARKER_ID = "__earlier-history__";

/** The scroller, however the caller is able to hand it over. See note 1. */
type ScrollSource =
  | Ref<HTMLDivElement | null>
  | (() => HTMLDivElement | null)
  | HTMLDivElement
  | null;

const props = withDefaults(
  defineProps<{
    scrollRef: ScrollSource;
    messages: UiMessage[];
    hasEarlier?: boolean;
    loadingEarlier?: boolean;
  }>(),
  { hasEarlier: false, loadingEarlier: false },
);

const emit = defineEmits<{ "reveal-earlier": [] }>();

const { t } = useI18n();

const instance = getCurrentInstance();
/**
 * The history dash is disabled when the caller passes no
 * `onRevealEarlier`. The emit form has no prop to test, so the question is
 * asked of the raw vnode props — the slot the compiler puts `@reveal-earlier`
 * in.
 *
 * A plain function called from the template, deliberately NOT a `computed`: a
 * computed with no reactive dependency is evaluated once and cached forever,
 * which is the one-shot read this replaced. `instance.vnode` is swapped before
 * each render (runtime-core `updateComponentPreRender` assigns it ahead of
 * `renderComponentRoot`), and a listener appearing or disappearing changes the
 * vnode's prop key count, so the parent's update re-renders this component and
 * the template re-reads the new vnode. That reproduces the per-render
 * `!onRevealEarlier`, where a listener bound only on a later render
 * (`@reveal-earlier="hasMore ? fn : undefined"`) enables the dash.
 *
 * Two known edges, both from testing a key rather than a prop:
 * `@reveal-earlier.once` compiles to `onRevealEarlierOnce`, which `emit()`
 * still dispatches but this test does not see (the dash would read as
 * disabled while the handler is live), and a listener whose identity changes
 * while its presence does not leaves the result unchanged, which is also
 * the outcome.
 */
function canRevealEarlier(): boolean {
  return typeof instance?.vnode.props?.onRevealEarlier === "function";
}

const activeId = ref<string | null>(null);
const hovered = ref<{
  marker: ConversationMinimapMarker;
  top: number;
} | null>(null);
const overflows = ref(false);
const railRef = ref<HTMLElement | null>(null);
let moveRaf = 0;

/* Cached offsets to avoid O(n) DOM queries on every scroll frame. */
let cachedOffsets: { id: string; offset: number }[] = [];

const markers = computed(() => buildConversationMinimapMarkers(props.messages));

const markerIdentity = computed(() =>
  [
    ...(props.hasEarlier ? [EARLIER_HISTORY_MARKER_ID] : []),
    ...markers.value.map((marker) => marker.id),
  ].join("\u0000"),
);

const markerCount = computed(
  () => markers.value.length + Number(props.hasEarlier),
);

const shown = computed(() =>
  shouldRenderConversationMinimap({
    markerCount: markers.value.length,
    overflows: overflows.value,
    hasEarlier: props.hasEarlier,
  }),
);

function scrollEl(): HTMLDivElement | null {
  const source = props.scrollRef;
  if (isRef(source)) return source.value;
  if (typeof source === "function") return source();
  return source;
}

/** Recompute cached offsets from DOM. Called on resize / marker changes only. */
function recomputeOffsets(): void {
  const el = scrollEl();
  if (!el) {
    cachedOffsets = [];
    return;
  }
  const baseTop = el.getBoundingClientRect().top;
  const markerIds = new Set(markers.value.map((marker) => marker.id));
  const out: { id: string; offset: number }[] = [];
  el.querySelectorAll<HTMLElement>("[data-minimap-id]").forEach((node) => {
    const id = node.dataset.minimapId || "";
    if (!markerIds.has(id)) return;
    out.push({
      id,
      offset: node.getBoundingClientRect().top - baseTop + el.scrollTop,
    });
  });
  cachedOffsets = out;
}

/**
 * Vertical centers of the dashes, in rail-local pixels.
 *
 * Dashes have a CSS-fixed height and magnify horizontally only, so their
 * centers change with the rail's layout, not with the cursor. Measuring them
 * once per layout keeps hover off the critical path: `applyMagnify` runs on
 * every mousemove frame, and reading `offsetTop` there — interleaved with the
 * `--magnify` writes it makes in the same loop — forced a synchronous reflow
 * per dash, so hovering a long conversation's rail cost O(markers) layouts a
 * frame. The element list is refreshed in the same read-only pass, so the
 * imperative writes below never touch the DOM twice.
 *
 * The dashes are the rail's own `<button>` children, in the order the template
 * renders them: the earlier-history dash first (when present), then one per
 * marker. That is the order the per-dash `ref` callbacks inserted into
 * its `Map`, and it keeps the DOM byte-identical —
 * nothing marks dashes with an id, so an id attribute here would be an
 * invention. (The popover is the only other child and is a `<div>`.)
 */
let magnifyCenters: { id: string; center: number }[] = [];
let markerEls = new Map<string, HTMLElement>();

function measureMagnifyCenters(): void {
  const ids = [
    ...(props.hasEarlier ? [EARLIER_HISTORY_MARKER_ID] : []),
    ...markers.value.map((marker) => marker.id),
  ];
  const elements = new Map<string, HTMLElement>();
  const centers: { id: string; center: number }[] = [];
  const dashes = railRef.value
    ? Array.from(railRef.value.querySelectorAll<HTMLElement>(":scope > button"))
    : [];
  // Read-only pass: no style writes, so layout is computed at most once.
  dashes.forEach((btn, index) => {
    const id = ids[index];
    if (!id) return;
    elements.set(id, btn);
    centers.push({ id, center: btn.offsetTop + btn.offsetHeight / 2 });
  });
  markerEls = elements;
  centers.sort((a, b) => a.center - b.center);
  magnifyCenters = centers;
}

/* Fresh offset query used only by jumpTo (needs pixel-accurate data). */
function getOffsets(): { id: string; offset: number }[] {
  const el = scrollEl();
  if (!el) return [];
  const baseTop = el.getBoundingClientRect().top;
  const markerIds = new Set(markers.value.map((marker) => marker.id));
  const out: { id: string; offset: number }[] = [];
  el.querySelectorAll<HTMLElement>("[data-minimap-id]").forEach((node) => {
    const id = node.dataset.minimapId || "";
    if (!markerIds.has(id)) return;
    out.push({
      id,
      offset: node.getBoundingClientRect().top - baseTop + el.scrollTop,
    });
  });
  return out;
}

/* Use cached offsets + binary search for O(log n) active tracking. */
function updateActive(): void {
  const el = scrollEl();
  if (!el) return;
  if (cachedOffsets.length === 0) {
    activeId.value = null;
    return;
  }
  const anchor = el.scrollTop + el.clientHeight * 0.3;
  // Binary search for the last offset <= anchor
  let lo = 0;
  let hi = cachedOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (cachedOffsets[mid].offset <= anchor) lo = mid;
    else hi = mid - 1;
  }
  activeId.value = cachedOffsets[lo].id;
}

function updateOverflow(): void {
  const el = scrollEl();
  if (!el) {
    overflows.value = false;
    return;
  }
  // One-page content has no scroll range; the rail is only useful when
  // overflowing.
  overflows.value = el.scrollHeight - el.clientHeight > OVERFLOW_EPSILON_PX;
}

function jumpTo(id: string): void {
  const el = scrollEl();
  if (!el) return;
  const target = getOffsets().find((entry) => entry.id === id);
  if (!target) return;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  el.scrollTo({
    top: Math.max(0, target.offset - 24),
    behavior: reduceMotion ? "auto" : "smooth",
  });
}

/* Dock magnification, applied imperatively so mousemove never re-renders.
 * Dash buttons keep a fixed height, so scaling is layout-stable. Centers come
 * from the cached measurement: writing `--magnify` while reading `offsetTop`
 * in the same loop would force one layout per dash on every hover frame. */
function applyMagnify(cursorY: number | null): void {
  if (magnifyCenters.length === 0) {
    // Nothing measured yet (first frame after mount): fall back to a
    // measurement rather than skipping the effect the user asked for.
    measureMagnifyCenters();
  }
  let nearest: { id: string; dist: number; center: number } | null = null;
  for (const { id, center } of magnifyCenters) {
    const btn = markerEls.get(id);
    if (!btn) continue;
    let scale = 1;
    if (cursorY != null) {
      const dist = Math.abs(center - cursorY);
      if (dist < MAGNIFY_RADIUS) {
        scale =
          1 +
          MAGNIFY_BOOST * Math.cos((dist / MAGNIFY_RADIUS) * (Math.PI / 2));
      }
      if (dist <= POPOVER_SNAP && (!nearest || dist < nearest.dist)) {
        nearest = { id, dist, center };
      }
    }
    btn.style.setProperty("--magnify", scale.toFixed(3));
  }
  if (nearest) {
    const marker = markers.value.find((m) => m.id === nearest!.id);
    const rail = railRef.value;
    if (marker && rail) {
      const top = Math.min(
        Math.max(nearest.center - 36, 0),
        Math.max(rail.clientHeight - POPOVER_HEIGHT, 0),
      );
      const previous = hovered.value;
      if (previous?.marker.id !== marker.id || previous.top !== top) {
        hovered.value = { marker, top };
      }
      return;
    }
  }
  hovered.value = null;
}

function handleMouseMove(event: MouseEvent): void {
  const rail = railRef.value;
  if (!rail) return;
  const y = event.clientY - rail.getBoundingClientRect().top;
  cancelAnimationFrame(moveRaf);
  moveRaf = requestAnimationFrame(() => applyMagnify(y));
}

function handleMouseLeave(): void {
  cancelAnimationFrame(moveRaf);
  applyMagnify(null);
}

/** The focus handler: the keyboard equivalent of hovering a dash. */
function showMarkerPopover(
  event: FocusEvent,
  marker: ConversationMinimapMarker,
): void {
  hovered.value = {
    marker,
    top: Math.max(0, (event.currentTarget as HTMLElement).offsetTop - 36),
  };
}

const earlierLabel = computed(() =>
  props.loadingEarlier
    ? t("chat.loadingEarlierMessages")
    : t("chat.showEarlierMessages"),
);

function roleLabel(role: ConversationMinimapMarker["role"]): string {
  return role === "user" ? t("chat.userMessage") : t("chat.assistantMessage");
}

/*
 * Re-measure whenever the marker set changes, and keep the active dash in
 * step with it: the two effects that used to do this.
 * scroller is in hand — see the watcher below, which is where the mount-time
 * measurement happens — because nothing can be measured before the element the
 * offsets are taken against exists.
 */
function measureMarkers(): void {
  recomputeOffsets();
  updateOverflow();
  measureMagnifyCenters();
  updateActive();
}

watch(markerIdentity, measureMarkers, { flush: "post" });

/* Dash centers follow the rail's own box, which is not driven by the marker
   set or the window alone: the rail's height is derived from
   `--composer-dock-height`, which the composer republishes as its draft grows.
   Observing the rail catches every cause, so magnification never tracks stale
   positions. `shown` gates whether the rail is mounted at all, so the observer
   has to be reattached when it returns — and the first observe callback is what
   measures the centers of a rail that has just appeared. */
watch(
  () => [railRef.value, overflows.value] as const,
  ([rail], _previous, onCleanup) => {
    if (!rail || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measureMagnifyCenters);
    });
    observer.observe(rail);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    });
  },
  { immediate: true, flush: "post" },
);

/**
 * The scroller, tracked. A caller passes either the element itself (a ref used
 * in a template binding is unwrapped before it reaches this prop, and the
 * parent's render re-runs when the ref is assigned) or the ref, or a getter
 * that reads it. The `computed` is what makes the first case work: on the very
 * first render the parent's template ref is still `null`, so the element only
 * arrives with the next pass, and the effect would have run against a
 * missing node.
 */
const scroller = computed(() => scrollEl());

/**
 * The rail observer, plus the mount half of the marker watcher.
 *
 * The dependencies were all stable callbacks, so the effect never
 * re-ran. The scroller cannot be read at mount here: a template ref on the
 * *parent* is assigned in the post-render flush, which is after every child's
 * `onMounted` callback, so an attach that ran then would wire a null element and
 * `overflows` would stay false forever — the rail would never appear. The
 * element is the watcher's dependency instead, and the initial measurements
 * (`measureMarkers`, the marker watcher below) happen once the element is
 * real. `flush: "post"` puts the attach after the post-render template-ref
 * flush, and `immediate` covers a caller that already had the element.
 */
watch(
  scroller,
  (el, _previous, onCleanup) => {
    if (!el) return;
    let scrollRaf = 0;
    let resizeRaf = 0;
    const scheduleScroll = () => {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => {
        updateActive();
        updateOverflow();
      });
    };
    const scheduleResize = () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        recomputeOffsets();
        updateActive();
        updateOverflow();
        // The rail's gap is marker-count dependent and its height follows the
        // composer, so dash centers move without the marker set changing.
        measureMagnifyCenters();
      });
    };
    // Initial offset computation, and the overflow test the rail's visibility
 // depends on. (the marker watcher, now that the element is in hand.)
    measureMarkers();
    el.addEventListener("scroll", scheduleScroll, { passive: true });
    // Streamed content can change layout between marker identity changes.
    const content = el.firstElementChild;
    const ro =
      content && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleResize)
        : null;
    if (ro && content) ro.observe(content);
    // Viewport resizes can create or remove overflow without content changes.
    window.addEventListener("resize", scheduleResize);
    onCleanup(() => {
      el.removeEventListener("scroll", scheduleScroll);
      ro?.disconnect();
      cancelAnimationFrame(scrollRaf);
      cancelAnimationFrame(resizeRaf);
      window.removeEventListener("resize", scheduleResize);
    });
  },
  { immediate: true, flush: "post" },
);

onBeforeUnmount(() => cancelAnimationFrame(moveRaf));
</script>

<template>
  <nav
    v-if="shown"
    ref="railRef"
    class="minimap-rail"
    :aria-label="t('chat.minimap')"
    :style="{ '--minimap-marker-count': markerCount }"
    @mousemove="handleMouseMove"
    @mouseleave="handleMouseLeave"
  >
    <TooltipButton
      v-if="hasEarlier"
      type="button"
      class="minimap-marker history"
      :class="{ loading: loadingEarlier }"
      :label="earlierLabel"
      :aria-label="earlierLabel"
      :aria-busy="loadingEarlier ? 'true' : undefined"
      :disabled="loadingEarlier || !canRevealEarlier()"
      @click="emit('reveal-earlier')"
    />
    <button
      v-for="marker in markers"
      :key="marker.id"
      class="minimap-marker"
      :class="[marker.role, { active: marker.id === activeId }]"
      :data-minimap-marker="marker.id"
      :aria-label="roleLabel(marker.role)"
      :aria-current="marker.id === activeId ? 'true' : undefined"
      @focus="showMarkerPopover($event, marker)"
      @blur="hovered = null"
      @click="jumpTo(marker.id)"
    />
    <div
      v-if="hovered && hovered.marker.preview"
      class="minimap-popover"
      role="tooltip"
      :style="{ top: `${hovered.top}px` }"
    >
      <div class="minimap-popover-role">
        {{ roleLabel(hovered.marker.role) }}
      </div>
      <div class="minimap-popover-text">{{ hovered.marker.preview }}</div>
    </div>
  </nav>
</template>
