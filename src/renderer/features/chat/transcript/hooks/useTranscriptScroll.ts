/**
 * The transcript scroller: follow mode, windowed hydration, the settle veil and
 * history paging, in one owner.
 *
 *
 *
 * Design notes, in the order the choices matter:
 *
 *   - `useRef` -> a plain binding for values only the hook reads and writes
 *     (`pinned`, `lastScrollTop`, `followFrame`, ...), and a `ref` where a write
 *     has to re-render (`firstCommit`, `windowSize`, `showJump`, `veilPhase`).
 *     `useState` -> `ref`.
 *   - `useCallback` -> a plain function. A function declared in a composable's
 *     setup is created once for the component's lifetime, so it is referentially
 *     stable without dep arrays, which is the guarantee effect and listener
 *     identity needs.
 *   - `useLayoutEffect` -> `onMounted` for the mount run plus
 *     `watch(deps, run, { flush: "post" })` for the updates. A `post` watcher
 *     runs after the DOM update and before paint; the mount run is a separate
 *     `onMounted`, because a watcher created during setup would run before the
 *     DOM — and therefore before any template ref — exists.
 *   - `useEffect` -> the same pair. `return () => ...` becomes the watcher's
 *     `onCleanup` (which fires before every re-run and on unmount) plus one
 *     `onScopeDispose` for the resources the mount run itself allocated.
 *   - `useMemo` -> `computed`. The memos that also cache object identity for
 *     their children (`entries`, `historyEntries`) keep that contract: a
 *     computed only re-evaluates when a tracked source changes and returns the
 *     cached value otherwise, which keeps the identity comparison the children
 *     rely on.
 *   - `useDeferredValue` has no equivalent here and is deliberately not faked; see
 *     `buildEntries` below.
 *   - Inputs that may be reactive are typed `MaybeRefOrGetter` and read with
 *     `toValue()` at the point
 *
 * The returned member names are unchanged.
 */
import {
  computed,
  onMounted,
  onScopeDispose,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";
import type {
  ContextCompactionMark,
  PlanningState,
  UiMessage,
} from "@dcode/shared";
import type { PendingPermission } from "../../../../lib/pending-permissions";
import {
  buildTranscriptEntries,
  reuseTranscriptEntries,
  transcriptEntryMessages,
  type TranscriptEntry,
} from "../../../../lib/assistant-turns";
import {
  createTranscriptSettleState,
  reduceTranscriptSettle,
  TRANSCRIPT_VEIL_FADE_MS,
} from "../../../../lib/transcript-settle";
import {
  growTranscriptWindow,
  reduceTranscriptWindow,
  TRANSCRIPT_INITIAL_MOUNT,
  TRANSCRIPT_WINDOW_MIN,
} from "../../../../lib/transcript-window";
import {
  HISTORY_REVEAL_THRESHOLD_PX,
  isHistoryRevealPosition,
  isRecentScrollGesture,
  isScrollGestureInput,
  reduceTranscriptScroll,
  transcriptHasLayout,
  TRANSCRIPT_SCROLL_ROUNDING_TOLERANCE_PX,
  type ScrollInputType,
} from "../../../../lib/transcript-scroll";
import { readScrollInputContext } from "../../../../lib/scroll-input";
import { useDisclosureAnchor } from "../../../../hooks/use-disclosure-anchor";
import type { DisclosureAnchorNotifier } from "../../../../lib/disclosure-anchor-context";
import type { TranscriptSearchTarget } from "../../../../lib/transcript-reading";
import { useTranscriptSearchFocus } from "../../../../hooks/use-transcript-search-focus";

type UseTranscriptScrollOptions = {
  sessionId: MaybeRefOrGetter<string | undefined>;
  messages: MaybeRefOrGetter<UiMessage[]>;
  compactions?: MaybeRefOrGetter<ContextCompactionMark[] | undefined>;
  hasMoreBefore: MaybeRefOrGetter<boolean>;
  onLoadOlder?: () => Promise<void>;
  isRunning: MaybeRefOrGetter<boolean>;
  pendingPermission?: MaybeRefOrGetter<PendingPermission | undefined>;
  askPending: MaybeRefOrGetter<boolean>;
  approvalPending: MaybeRefOrGetter<boolean>;
  planningState?: MaybeRefOrGetter<PlanningState | undefined>;
  paneVisible: MaybeRefOrGetter<boolean>;
  searchTarget: MaybeRefOrGetter<TranscriptSearchTarget | null>;
  readingWindow: MaybeRefOrGetter<boolean>;
};

type VeilPhase = "covering" | "leaving" | "off";

export type TranscriptScroll = {
  scrollRef: Ref<HTMLDivElement | null>;
  wrapRef: Ref<HTMLDivElement | null>;
  contentRef: Ref<HTMLDivElement | null>;
  historyBoundaryRef: Ref<HTMLDivElement | null>;
  loadingOlder: Ref<boolean>;
  showJump: Ref<boolean>;
  historyEntries: ComputedRef<TranscriptEntry[]>;
  tailEntry: ComputedRef<TranscriptEntry | undefined>;
  minimapMessages: ComputedRef<UiMessage[]>;
  hasEarlierHistory: ComputedRef<boolean>;
  hydrationBounded: ComputedRef<boolean>;
  veilCovering: ComputedRef<boolean>;
  veilPhase: Ref<VeilPhase>;
  handleScroll: () => void;
  revealEarlierHistory: () => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  jumpToLatest: () => void;
  disclosureAnchorNotifier: DisclosureAnchorNotifier;
};

export function useTranscriptScroll({
  sessionId,
  messages,
  compactions,
  hasMoreBefore,
  onLoadOlder,
  isRunning,
  pendingPermission,
  askPending,
  approvalPending,
  planningState,
  paneVisible,
  searchTarget,
  readingWindow,
}: UseTranscriptScrollOptions): TranscriptScroll {
  const scrollRef = ref<HTMLDivElement | null>(null);
  const wrapRef = ref<HTMLDivElement | null>(null);
  const contentRef = ref<HTMLDivElement | null>(null);
  const historyBoundaryRef = ref<HTMLDivElement | null>(null);
  let pinned = true;
  let lastScrollTop = 0;
  // Last offset sampled while the scroller had a real layout box. A hidden
  // pane's `content-visibility: hidden` box reports `scrollTop === 0`, so the
  // hide transition must restore this rather than the collapsed value.
  let lastLaidOutScrollTop = 0;
  let lastScrollGestureAt = -Infinity;
  let wasRunning = toValue(isRunning);
  let followFrame = 0;
  let prependHeight: number | null = null;
  const loadingOlder = ref(false);
  const showJump = ref(false);

  // Steady-state cap on mounted history rows (D261). Grows when the user
  // reaches the top of the window; reset per session below.
  const windowSize = ref(TRANSCRIPT_WINDOW_MIN);
  let previousEntries: TranscriptEntry[] = [];
  let previousSessionId = toValue(sessionId);

  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    const el = scrollRef.value;
    if (!el || !transcriptHasLayout(el)) return;
    const targetTop = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTo({ top: targetTop, behavior });
    // `scrollTo({ behavior: "auto" })` is synchronous. Record the position the
    // scroller actually reached, not the one that was asked for: at a
    // fractional device pixel ratio the browser lands a fraction of a pixel
    // away (asked 841, got 840.909), and the intended value would make the
    // following native scroll event read as the user scrolling up.
    if (behavior === "auto") {
      lastScrollTop = el.scrollTop;
      lastLaidOutScrollTop = el.scrollTop;
    }
  }

  function cancelFollowScroll() {
    cancelAnimationFrame(followFrame);
    followFrame = 0;
  }

  // A manual disclosure (a tool, thinking or activity title; #324) hands this
  // scroller the very title it was toggled from, before the expansion state
  // changes. Follow mode is left first — re-bottoming the expansion is exactly
  // what dragged the clicked title out of view — and the held position is
  // restored from the observer below for every frame of the height transition.
  function enterDisclosureReading() {
    cancelFollowScroll();
    pinned = false;
    showJump.value = true;
  }
  function recordScrollPosition(top: number) {
    lastScrollTop = top;
    lastLaidOutScrollTop = top;
  }
  const {
    notifier: disclosureAnchorNotifier,
    restore: restoreDisclosureAnchor,
    release: releaseDisclosureAnchor,
    isHeld: isDisclosureAnchorHeld,
  } = useDisclosureAnchor(scrollRef, enterDisclosureReading, recordScrollPosition);

  // A user scroll-up gesture always emits input before its scroll events;
  // programmatic follow scrolling and layout clamps (composer collapse on
  // send, indicator mount/unmount) never do. Track the last real input so
  // `handleScroll` can tell the two apart and never let a clamp between a
  // follow `scrollTo` and its native event release follow mode. Only input
  // that can move *this* scroller counts: a press on a row control is an
  // ordinary click, a field owns its own keys, and a gesture a nested dock
  // consumes belongs to that dock.
  function markScrollGesture(event: Event) {
    const input = readScrollInputContext(
      event,
      scrollRef.value,
      contentRef.value,
    );
    if (!isScrollGestureInput(event.type as ScrollInputType, input)) return;
    lastScrollGestureAt = performance.now();
    // Real input takes the viewport back from a held disclosure position.
    releaseDisclosureAnchor();
  }

  const GESTURE_EVENTS = [
    "wheel",
    "touchstart",
    "touchmove",
    "pointerdown",
    "keydown",
  ] as const;

  // The listeners are attached in an effect keyed on `markScrollGesture`, which
  // resolved `wrapRef.current` once the commit had happened. Here the element
  // itself is the source: the watcher runs when the ref is populated, which is
  // the same moment, and its cleanup re-runs whenever the element is replaced.
  watch(
    wrapRef,
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

  // This instance belongs to one session for its whole lifetime (ADR 0137), so
  // "activation" is its own first layout: settle at the newest turn before the
  // first paint, with no cross-session state to unwind.
  onMounted(() => {
    releaseDisclosureAnchor();
    cancelFollowScroll();
    pinned = true;
    showJump.value = false;
    scrollToBottom();
  });

  // Revisits restore this pane's own position. A hidden scroller can be clamped
  // while its content grows off screen, so the offset is captured on the way out
  // and reapplied during the layout phase that reveals the pane: a pane the user
  // had scrolled up in returns to that offset, a pinned one returns to the
  // bottom, and neither shows an intermediate frame.
  let retainedScrollTop: number | null = null;
  let wasPaneVisible = toValue(paneVisible);
  const restorePaneScroll = () => {
    const el = scrollRef.value;
    const visible = toValue(paneVisible);
    const becameHidden = wasPaneVisible && !visible;
    const becameVisible = !wasPaneVisible && visible;
    // The transition is only consumed once there is a scroller to read or
    // position. Committing it before this guard would swallow the edge and lose
    // the offset a pane hidden before its scroller existed should return to.
    if (!el) return;
    wasPaneVisible = visible;
    if (becameHidden) {
      releaseDisclosureAnchor();
      cancelFollowScroll();
      // Do not read `el.scrollTop` here: the hide CSS has already skipped
      // rendering, so the box reports 0. Restore the last laid-out offset.
      retainedScrollTop = lastLaidOutScrollTop;
      return;
    }
    if (!becameVisible) return;
    if (pinned) {
      scrollToBottom();
      return;
    }
    const retained = retainedScrollTop;
    if (retained === null) return;
    el.scrollTop = retained;
    lastScrollTop = retained;
    lastLaidOutScrollTop = retained;
  };
  onMounted(restorePaneScroll);
  watch(() => toValue(paneVisible), restorePaneScroll, { flush: "post" });

  // A hidden pane must not chase its stream: its scroller has no visible
  // viewport, and the measurements a follow scroll depends on are unreliable
  // while it is out of view. It re-anchors when it is revealed instead.
  // (A ref mirror of `paneVisible` was needed only because a callback
  // had to stay referentially stable for the scroll listener; reading the
  // current value here is the same thing without the mirror.)
  function scheduleFollowScroll() {
    if (!toValue(paneVisible)) return;
    // A held disclosure position wins over a queued follow frame: re-asserting
    // the bottom here would move the title the reader just toggled even though
    // the observer below already refuses to.
    if (!pinned || followFrame !== 0) return;
    if (isDisclosureAnchorHeld()) return;
    followFrame = requestAnimationFrame(() => {
      followFrame = 0;
      if (toValue(paneVisible) && pinned) scrollToBottom();
    });
  }

  // Re-pins before the browser paints. A ResizeObserver callback runs after
  // layout and before paint, so a `requestAnimationFrame` requested from it
  // lands in the *next* frame: the current frame painted the grown content
  // unpinned and the next one snapped it back, which read as the transcript
  // twitching whenever a row changed height after mount (D287). Scrolling from
  // inside the callback costs nothing extra (layout is already clean) and
  // cannot resize the observed box, so it never re-triggers the observer.
  //
  // A manual disclosure holds the title the reader toggled (#324) and is
  // restored first: its height can keep changing for several frames, and
  // re-pinning on any one of them is what dragged that title out of view.
  function followScrollNow() {
    if (toValue(paneVisible) && restoreDisclosureAnchor()) return;
    if (!toValue(paneVisible) || !pinned) return;
    cancelFollowScroll();
    scrollToBottom();
  }

  // Disposed with the scope rather than with a watcher: the follow frame has to
  // outlive a cleanup that fires before every re-run.
  onScopeDispose(cancelFollowScroll);

  function loadOlder() {
    const el = scrollRef.value;
    // Paging is a reading gesture, so a hidden pane never initiates one.
    if (!toValue(paneVisible)) return;
    if (!el || !toValue(hasMoreBefore) || loadingOlder.value || !onLoadOlder) {
      return;
    }
    // Prepending rows changes scrollHeight. Capture the old height so the
    // user's viewport stays anchored to the same message after the page lands.
    prependHeight = el.scrollHeight;
    loadingOlder.value = true;
    void onLoadOlder().finally(() => {
      loadingOlder.value = false;
    });
  }

  /**
   * Reaching the top escalates in two stages (D261): mount more of what is
   * already loaded, and only fetch an older page once the window covers all of
   * it. Both stages anchor the viewport the same way, because both change
   * scrollHeight above the rows the user is reading.
   */
  function reachTop() {
    const el = scrollRef.value;
    if (!el) return;
    const grown = growTranscriptWindow(
      windowSize.value,
      allHistoryEntries.value.length,
    );
    if (grown !== windowSize.value) {
      // Mounting rows above the viewport changes scrollHeight exactly the way a
      // fetched page does, so it takes the same anchor.
      prependHeight = el.scrollHeight;
      windowSize.value = grown;
      return;
    }
    loadOlder();
  }

  // Anchors the viewport whenever rows appear above it — a fetched older page
  // (`messages.length`) or a grown mounted window (`windowSize`, D261). Both add
  // height above the reading position, so both are corrected here before paint.
  const anchorPrependedRows = () => {
    const previousHeight = prependHeight;
    if (previousHeight === null) return;
    const el = scrollRef.value;
    prependHeight = null;
    if (!el) return;
    const delta = el.scrollHeight - previousHeight;
    if (delta <= 0) return;
    el.scrollTop += delta;
    lastScrollTop = el.scrollTop;
    if (transcriptHasLayout(el)) lastLaidOutScrollTop = el.scrollTop;
  };
  onMounted(anchorPrependedRows);
  watch(
    [() => toValue(messages).length, windowSize],
    anchorPrependedRows,
    { flush: "post" },
  );

  // Follow the stream only while the user is pinned to the bottom; a manual
  // scroll up pauses following and surfaces the jump-to-latest pill.
  function handleScroll() {
    const el = scrollRef.value;
    if (!el) return;
    // A real gesture is never stale noise: the reader's own input took the
    // scroller to the near-top band, and this event is the last one that
    // position produces. Suppressing history continuation here would strand an
    // overflowing transcript at the top until some other scroll event or the
    // minimap control arrived (D269). Only an offset this event did not produce
    // — a collapsed box, or a pinned scroller still about to be restored to the
    // bottom — is read as "not at the top".
    const gesturing = isRecentScrollGesture(
      performance.now(),
      lastScrollGestureAt,
    );
    if (
      toValue(paneVisible) &&
      isHistoryRevealPosition(el, pinned && !gesturing)
    ) {
      reachTop();
    }
    if (toValue(readingWindow)) {
      pinned = false;
      lastScrollTop = el.scrollTop;
      showJump.value = true;
      return;
    }
    const wasPinned = pinned;
    // Only a real gesture (wheel / trackpad / touch / scrollbar / keyboard,
    // on this scroller) releases follow. When the composer collapses or an
    // indicator row unmounts right after send, the browser clamps scrollTop
    // and emits a scroll event that looks like an upward gesture; without
    // this guard it would cancel follow and leave the transcript stuck above
    // the new turn. The tolerance is slack for the fractions a fractional
    // device pixel ratio leaves behind on programmatic corrections; anything a
    // gesture produced is compared exactly, so a one-pixel scroll still
    // unpins.
    // `gesturing` was read above, before the history-reveal question: a real
    // gesture is what makes a near-top offset the reader's own position.
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
      // Programmatic / layout noise: re-baseline the observed position and
      // keep the follow state unchanged instead of treating it as a user
      // gesture. A pinned transcript re-asserts the bottom; an unpinned one
      // stays unpinned.
      pinned = wasPinned;
      showJump.value = !wasPinned;
      scheduleFollowScroll();
    } else {
      pinned = transition.pinned;
      showJump.value = transition.showJump;
    }
  }

  // Send / retry / regenerate always re-pins follow mode so the new prompt and
  // its stream stay in view, even if the user had scrolled up through history.
  // This must run in the layout phase: the send state is committed before the
  // persisted user-message event arrives, and a passive effect allows one
  // frame where a long transcript can remain at its old/top position.
  const repinOnTurnStart = () => {
    const running = toValue(isRunning);
    const turnStarted = running && !wasRunning;
    wasRunning = running;
    if (!turnStarted || !toValue(paneVisible)) return;
    releaseDisclosureAnchor();
    cancelFollowScroll();
    pinned = true;
    showJump.value = false;
    scrollToBottom();
    scheduleFollowScroll();
  };
  onMounted(repinOnTurnStart);
  watch([() => toValue(isRunning), () => toValue(paneVisible)], repinOnTurnStart, {
    flush: "post",
  });

  const followStreamTail = () => {
    scheduleFollowScroll();
  };
  onMounted(followStreamTail);
  watch(
    [
      () => toValue(messages),
      () => toValue(isRunning),
      () => toValue(pendingPermission)?.requestId,
      () => toValue(askPending),
      () => toValue(approvalPending),
      () => toValue(planningState),
    ],
    followStreamTail,
    { flush: "post" },
  );

  // Streamed Markdown, expanded activity rows, late images, and diagrams change
  // the content height without a render commit, so pinned follow is kept in sync
  // from the observed layout. The content is observed on its border box: the
  // bottom padding is the composer's published height, and a multi-line draft
  // growing that padding must re-pin too, or the newest turn slides behind the
  // composer until the next commit happens to re-pin it. The content box does
  // not include padding and would miss that change entirely. The scroller is
  // observed as well so a window or work-panel resize keeps the bottom in view.
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

  /**
   * The transcript projection.
   *
   * The source is the current messages, not a deferred copy. Vue's renderer is
   * synchronous, so the committed DOM already holds the current value and there
   * is no lower-priority lane to hand the streaming tail to; faking deferral
   * with a delayed ref would paint the live tail a frame behind the stream for
   * no benefit.
   *
   * A session change drops the cache before the new entries are built, in that
   * order.
   */
  const entries = computed(() => {
    const id = toValue(sessionId);
    if (previousSessionId !== id) {
      previousSessionId = id;
      previousEntries = [];
    }
    const built = buildTranscriptEntries(
      toValue(messages),
      toValue(compactions),
    );
    const next = reuseTranscriptEntries(previousEntries, built.entries);
    previousEntries = next;
    return { entries: next, visible: built.visible };
  });
  // Memoized so a re-render that changed no message (jump pill, loading row,
  // window growth) hands `TranscriptHistory` the same array, letting its
  // comparator bail on identity instead of walking every mounted row.
  const allHistoryEntries = computed(() => entries.value.entries.slice(0, -1));
  const tailEntry = computed(() => entries.value.entries.at(-1));

  // Progressive hydration, now scoped to this pane's own first commit
  // (ADR 0137): mount only the bottom portion of the transcript when the pane
  // mounts, then expand to the steady-state window after paint, with a spacer
  // holding the scroll height. Because the instance belongs to one session, the
  // gate is plain local mount state rather than a comparison against whichever
  // session was rendered last.
  //
  // The gate has to be derived during render, not set from an effect. Deciding
  // it from a layout effect mounted the *whole* history first and only then cut
  // it back to the budget, so a long session built its entire DOM, discarded it,
  // and rebuilt it, which is the opposite of what bounding the first commit is
  // for.
  //
  // The expansion target is the mounted window (D261), not the whole history: a
  // paged-in session used to end up with every row mounted for good, retaining
  // its Markdown and highlighting for rows nobody was looking at.
  const hydrationTick = ref(0);
  // A `ref`, not a plain binding: the flag and the tick always change together,
  // so keeping the flag reactive preserves that pairing when only the flag
  // moves.
  const firstCommit = ref(true);
  const hydrationBounded = computed(
    () =>
      !toValue(readingWindow) &&
      firstCommit.value &&
      allHistoryEntries.value.length > TRANSCRIPT_INITIAL_MOUNT,
  );
  // The bounded commit and the expansion must show the transcript at the same
  // place. A spacer sized from a per-entry guess cannot match the rows it stands
  // in for, so the expansion moved the visible text by the estimate error - the
  // reported page-flip jitter on a session switch. The spacer now only reserves
  // enough height to make the bottom reachable, and the expansion re-pins the
  // exact bottom in the same layout phase it commits in.
  //
  // The "needs re-anchoring" flag is derived from which session was bounded, not
  // written during render: StrictMode double-renders and abandoned concurrent
  // renders would otherwise leave a plain boolean ref set and re-bottom a
  // transcript the user had scrolled up in.
  let boundedFirstCommit = false;
  let hydrationFrame = 0;
  const boundFirstCommit = () => {
    if (!hydrationBounded.value) {
      // An empty first paint must not spend this gate: revalidation can still
      // land a long transcript that needs the bounded expand and re-bottom.
      if (allHistoryEntries.value.length > 0) firstCommit.value = false;
      return;
    }
    boundedFirstCommit = true;
    hydrationFrame = requestAnimationFrame(() => {
      hydrationFrame = 0;
      firstCommit.value = false;
      hydrationTick.value += 1;
    });
  };
  // `immediate` runs the mount pass; it only reads the gate and queues a frame,
  // so running it during setup rather than after mount is equivalent.
  watch(
    [hydrationBounded, hydrationTick, () => allHistoryEntries.value.length],
    (_value, _previous, onCleanup) => {
      boundFirstCommit();
      onCleanup(() => {
        cancelAnimationFrame(hydrationFrame);
        hydrationFrame = 0;
      });
    },
    { flush: "post", immediate: true },
  );

  // Settle veil (D287). A bounded first commit means the transcript is long
  // enough for its geometry to keep moving for several frames after mount: the
  // expansion, then rows whose height resolves only once laid out. Rather than
  // painting that motion, an opaque skeleton covers the scroller until the
  // geometry has held still (or a hard time cap passes) and then fades out.
  // Short transcripts mount in one commit and never show the veil. The phase is
  // initialised from the first render's own gate so the veil is in the commit
  // that reveals the pane, not one frame later.
  const veilPhase = ref<VeilPhase>(hydrationBounded.value ? "covering" : "off");
  const veilCovering = computed(() => veilPhase.value === "covering");

  const transcriptWindow = computed(() =>
    reduceTranscriptWindow({
      historyLength: allHistoryEntries.value.length,
      windowSize: toValue(readingWindow)
        ? allHistoryEntries.value.length
        : windowSize.value,
      initialCommit: hydrationBounded.value,
    }),
  );
  // Memoized so unrelated re-renders (jump pill, loading row) hand
  // `TranscriptHistory` the same array and it can bail on identity instead of
  // walking every mounted row.
  const historyEntries = computed(() =>
    transcriptWindow.value.bounded
      ? allHistoryEntries.value.slice(-transcriptWindow.value.mounted)
      : allHistoryEntries.value,
  );

  function releaseSearchFollow(fresh: boolean) {
    if (fresh) prependHeight = null;
    releaseDisclosureAnchor();
    cancelFollowScroll();
    pinned = false;
    showJump.value = true;
  }
  const searchSource = computed(
    () =>
      toValue(messages).find(
        (message) => message.id === toValue(searchTarget)?.messageId,
      )?.content ?? "",
  );
  useTranscriptSearchFocus({
    target: searchTarget,
    source: searchSource,
    visible: paneVisible,
    scrollRef,
    contentRef,
    contentVersion: historyEntries,
    onNavigate: releaseSearchFollow,
    onPosition: recordScrollPosition,
  });

  // Runs in the same layout phase the expansion commits in, before the browser
  // paints it, so mounting the remaining history cannot move the rows the user
  // is already looking at. A user who scrolled up during the bounded frame keeps
  // their position: only a still-pinned transcript is re-bottomed. (No mount run
  // is needed: `boundedFirstCommit` is still false on mount, so a first pass
  // would return without doing anything either.)
  const repinAfterExpansion = () => {
    if (hydrationBounded.value || !boundedFirstCommit) return;
    boundedFirstCommit = false;
    if (!pinned) return;
    cancelFollowScroll();
    scrollToBottom();
  };
  watch([hydrationBounded, hydrationTick], repinAfterExpansion, {
    flush: "post",
  });

  // Sample the scroller once per frame from the expansion commit onward and
  // lift the veil once the geometry has stopped moving. The bounded commit
  // itself is not sampled: the expansion that follows it changes the height by
  // design. Each sample also re-pins a still-pinned transcript, so the frame the
  // veil reveals is already at the newest turn. A hidden pane pauses sampling
  // (its scroller reports no usable geometry) and resumes when revealed.
  let settleFrame = 0;
  const sampleUntilSettled = () => {
    if (!veilCovering.value || hydrationBounded.value || !toValue(paneVisible)) {
      return;
    }
    const el = scrollRef.value;
    if (!el) return;
    let state = createTranscriptSettleState(performance.now());
    const sample = () => {
      settleFrame = 0;
      if (pinned) scrollToBottom();
      const step = reduceTranscriptSettle(
        state,
        { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight },
        performance.now(),
      );
      state = step.state;
      if (step.settled) {
        veilPhase.value = "leaving";
        return;
      }
      settleFrame = requestAnimationFrame(sample);
    };
    settleFrame = requestAnimationFrame(sample);
  };
  onMounted(sampleUntilSettled);
  watch(
    [hydrationBounded, paneVisible, veilCovering],
    (_value, _previous, onCleanup) => {
      sampleUntilSettled();
      onCleanup(() => {
        cancelAnimationFrame(settleFrame);
        settleFrame = 0;
      });
    },
    { flush: "post" },
  );

  let veilTimer = 0;
  const fadeVeilOut = () => {
    if (veilPhase.value !== "leaving") return;
    veilTimer = window.setTimeout(() => {
      veilTimer = 0;
      veilPhase.value = "off";
    }, TRANSCRIPT_VEIL_FADE_MS);
  };
  onMounted(fadeVeilOut);
  watch(
    veilPhase,
    (_value, _previous, onCleanup) => {
      fadeVeilOut();
      onCleanup(() => {
        window.clearTimeout(veilTimer);
        veilTimer = 0;
      });
    },
    { flush: "post" },
  );

  // The minimap must describe the mounted rows, not every loaded message: it
  // resolves a click by looking up the marker's node in the scroller, so a dash
  // for a withheld row would jump nowhere (D261).
  const minimapMessages = computed(() => {
    const tail = tailEntry.value;
    return transcriptWindow.value.bounded
      ? transcriptEntryMessages(
          tail ? [...historyEntries.value, tail] : historyEntries.value,
        )
      : entries.value.visible;
  });
  const hasEarlierHistory = computed(
    () => transcriptWindow.value.hiddenAbove > 0 || toValue(hasMoreBefore),
  );

  function revealEarlierHistory() {
    const el = scrollRef.value;
    if (!el) return;
    if (isHistoryRevealPosition(el)) {
      reachTop();
      return;
    }
    releaseDisclosureAnchor();
    cancelFollowScroll();
    pinned = false;
    showJump.value = true;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    el.scrollTo({
      top: 0,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

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

  // D269: history progression follows the visible top boundary, not only a
  // native scroll event. A tail page can collapse to less than one viewport,
  // and a fetched page can initially sit outside the mounted window; neither
  // case changes scrollTop, so the old scroll-only trigger could strand both
  // the earlier transcript and the minimap. Re-observing after each window/page
  // transition keeps advancing until the boundary leaves the near-top band or
  // no earlier history remains.
  let boundaryFrame = 0;
  let boundaryObserver: IntersectionObserver | null = null;
  const observeHistoryBoundary = () => {
    const root = scrollRef.value;
    const boundary = historyBoundaryRef.value;
    if (!root || !boundary || !hasEarlierHistory.value) return;
    // A hidden pane's scroller is unrendered and reports `scrollTop === 0`,
    // which reads as "at the top" and would page history for a session nobody is
    // looking at. The pane re-evaluates when it is revealed, because
    // `paneVisible` is a dependency of this effect.
    if (!toValue(paneVisible)) return;
    const advanceIfHistoryBoundaryVisible = () => {
      cancelAnimationFrame(boundaryFrame);
      boundaryFrame = requestAnimationFrame(() => {
        boundaryFrame = 0;
        if (
          scrollRef.value !== root ||
          !isHistoryRevealPosition(root, pinned)
        ) {
          return;
        }
        reachTop();
      });
    };

    // Covers an underfilled tail immediately, including environments without
    // IntersectionObserver; the observer then owns subsequent visibility changes.
    advanceIfHistoryBoundaryVisible();
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) {
          advanceIfHistoryBoundaryVisible();
        }
      },
      {
        root,
        rootMargin: `${HISTORY_REVEAL_THRESHOLD_PX}px 0px 0px 0px`,
      },
    );
    observer.observe(boundary);
    boundaryObserver = observer;
  };
  const disconnectHistoryObserver = () => {
    cancelAnimationFrame(boundaryFrame);
    boundaryFrame = 0;
    boundaryObserver?.disconnect();
    boundaryObserver = null;
  };
  onMounted(observeHistoryBoundary);
  // `hiddenAbove` is a dependency because an IntersectionObserver does not
  // re-notify while the boundary stays continuously visible: growing the
  // window changes neither `messages.length` nor the intersection state, so
  // without it a still-underfilled transcript would advance exactly once and
  // then stall with loaded rows unmounted. Each re-run performs one bounded
  // growth step, so the escalation stays monotonic and terminates when the
  // window covers the loaded history or the boundary leaves the band.
  watch(
    [
      hasEarlierHistory,
      hydrationTick,
      loadingOlder,
      () => toValue(messages).length,
      () => toValue(paneVisible),
      () => toValue(sessionId),
      () => transcriptWindow.value.hiddenAbove,
    ],
    (_value, _previous, onCleanup) => {
      observeHistoryBoundary();
      onCleanup(disconnectHistoryObserver);
    },
    { flush: "post" },
  );

  // The mount runs above are not wrapped by a watcher's cleanup, so their
  // in-flight frames, timers and observer are released here.
  onScopeDispose(() => {
    cancelAnimationFrame(hydrationFrame);
    hydrationFrame = 0;
    cancelAnimationFrame(settleFrame);
    settleFrame = 0;
    window.clearTimeout(veilTimer);
    veilTimer = 0;
    disconnectHistoryObserver();
  });

  return {
    scrollRef,
    wrapRef,
    contentRef,
    historyBoundaryRef,
    loadingOlder,
    showJump,
    historyEntries,
    tailEntry,
    minimapMessages,
    hasEarlierHistory,
    hydrationBounded,
    veilCovering,
    veilPhase,
    handleScroll,
    revealEarlierHistory,
    scrollToBottom,
    jumpToLatest,
    disclosureAnchorNotifier,
  };
}
