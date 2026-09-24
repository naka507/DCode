/**
 * Stick-to-bottom follow for a nested scroller (D302).
 *
 *
 *
 * Same contract as the main transcript: pin on mount, follow while pinned,
 * release only on a real upward gesture, and re-pin from a jump control.
 * Layout clamps and programmatic `scrollTo` never count as a user gesture.
 * A manual disclosure holds its own reading position here too (#324), and the
 * hold also reaches the scroller this one is nested in, because growing these
 * rows grows that one's content as well.
 *
 * `useRef` becomes a `ref`/plain binding, `useState` a `ref`,
 * `useCallback` a plain function, `useEffect` a `watch` and `useLayoutEffect` a
 * `watch(..., { flush: "post" })` or `onMounted`. The returned member names are
 * unchanged.
 */
import {
  onMounted,
  onScopeDispose,
  ref,
  watch,
  type Ref,
} from "vue";
import {
  isRecentScrollGesture,
  isScrollGestureInput,
  reduceTranscriptScroll,
  TRANSCRIPT_SCROLL_ROUNDING_TOLERANCE_PX,
  type ScrollInputType,
} from "../lib/transcript-scroll";
import { readScrollInputContext } from "../lib/scroll-input";
import type { DisclosureAnchorNotifier } from "../lib/disclosure-anchor-context";
import { useDisclosureAnchor } from "./use-disclosure-anchor";

export type FollowScroll = {
  scrollRef: Ref<HTMLDivElement | null>;
  contentRef: Ref<HTMLDivElement | null>;
  showJump: Ref<boolean>;
  handleScroll: () => void;
  jumpToLatest: () => void;
  scheduleFollowScroll: () => void;
  releaseFollow: () => void;
  /** Provided around this scroller's rows so their disclosures can hold it. */
  disclosureAnchorNotifier: DisclosureAnchorNotifier;
};

export function useFollowScroll(): FollowScroll {
  const scrollRef = ref<HTMLDivElement | null>(null);
  const contentRef = ref<HTMLDivElement | null>(null);
  let pinned = true;
  let lastScrollTop = 0;
  let lastScrollGestureAt = -Infinity;
  let followFrame = 0;
  const showJump = ref(false);

  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    const el = scrollRef.value;
    if (!el) return;
    const targetTop = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTo({ top: targetTop, behavior });
    // Record the position the scroller actually reached, not the one that was
    // asked for: a fractional device pixel ratio lands a fraction of a pixel
    // away, and the intended value would make the following native scroll event
    // read as the user scrolling up.
    if (behavior === "auto") lastScrollTop = el.scrollTop;
  }

  function cancelFollowScroll() {
    cancelAnimationFrame(followFrame);
    followFrame = 0;
  }

  function recordScrollPosition(top: number) {
    lastScrollTop = top;
  }

  const {
    notifier: disclosureAnchorNotifier,
    restore: restoreDisclosureAnchor,
    release: releaseDisclosureAnchor,
    isHeld: isDisclosureAnchorHeld,
  } = useDisclosureAnchor(scrollRef, () => {
    cancelFollowScroll();
    pinned = false;
    showJump.value = true;
  }, recordScrollPosition);

  function markScrollGesture(event: Event) {
    const input = readScrollInputContext(
      event,
      scrollRef.value,
      contentRef.value,
    );
    if (!isScrollGestureInput(event.type as ScrollInputType, input)) return;
    lastScrollGestureAt = performance.now();
    releaseDisclosureAnchor();
  }

  const GESTURE_EVENTS = ["wheel", "touchstart", "touchmove", "pointerdown", "keydown"] as const;

  watch(
    scrollRef,
    (el, _previous, onCleanup) => {
      if (!el) return;
      for (const name of GESTURE_EVENTS) {
        el.addEventListener(name, markScrollGesture, { passive: true });
      }
      onCleanup(() => {
        for (const name of GESTURE_EVENTS) {
          el.removeEventListener(name, markScrollGesture);
        }
      });
    },
    { immediate: true },
  );

  // Mount layout effect: pin before the first paint.
  onMounted(() => {
    releaseDisclosureAnchor();
    cancelFollowScroll();
    pinned = true;
    showJump.value = false;
    scrollToBottom();
  });

  function scheduleFollowScroll() {
    // A queued follow frame must not move the title the reader just toggled:
    // the observer below already refuses to, and this path would undo it.
    if (!pinned || followFrame !== 0) return;
    if (isDisclosureAnchorHeld()) return;
    followFrame = requestAnimationFrame(() => {
      followFrame = 0;
      if (pinned) scrollToBottom();
    });
  }

  // Re-pin in the observer callback itself (D287): a rAF scheduled from
  // ResizeObserver paints one unpinned frame before the follow lands. A held
  // disclosure position takes precedence — it is what keeps the clicked title
  // still while the dock's rows animate. (`useDisclosureAnchor` already passes
  // this hold outward to the scroller this one is nested in.)
  function followScrollNow() {
    if (restoreDisclosureAnchor()) return;
    if (!pinned) return;
    cancelFollowScroll();
    scrollToBottom();
  }

  onScopeDispose(() => {
    cancelFollowScroll();
    releaseDisclosureAnchor();
  });

  function handleScroll() {
    const el = scrollRef.value;
    if (!el) return;
    const wasPinned = pinned;
    // Real input is compared exactly; without it, sub-pixel slack keeps a
    // fractional device pixel ratio from reading as the user scrolling up.
    const gesturing = isRecentScrollGesture(
      performance.now(),
      lastScrollGestureAt,
    );
    const transition = reduceTranscriptScroll({
      previousScrollTop: lastScrollTop,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      wasPinned,
      tolerancePx: gesturing ? 0 : TRANSCRIPT_SCROLL_ROUNDING_TOLERANCE_PX,
    });
    lastScrollTop = el.scrollTop;
    if (transition.releasedFollow) cancelFollowScroll();
    if (gesturing && transition.releasedFollow) {
      pinned = false;
      showJump.value = true;
    } else if (transition.releasedFollow) {
      pinned = wasPinned;
      showJump.value = !wasPinned;
      scheduleFollowScroll();
    } else {
      pinned = transition.pinned;
      showJump.value = transition.showJump;
    }
  }

  watch(
    () => [contentRef.value, scrollRef.value] as const,
    ([content, scroller], _previous, onCleanup) => {
      if (!content || !scroller || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(followScrollNow);
      ro.observe(content, { box: "border-box" });
      ro.observe(scroller, { box: "border-box" });
      onCleanup(() => ro.disconnect());
    },
    { immediate: true, flush: "post" },
  );

  function jumpToLatest() {
    releaseDisclosureAnchor();
    pinned = true;
    showJump.value = false;
    scrollToBottom(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    );
  }

  function releaseFollow() {
    releaseDisclosureAnchor();
    cancelFollowScroll();
    pinned = false;
    showJump.value = true;
  }

  return {
    scrollRef,
    contentRef,
    showJump,
    handleScroll,
    jumpToLatest,
    scheduleFollowScroll,
    releaseFollow,
    disclosureAnchorNotifier,
  };
}
