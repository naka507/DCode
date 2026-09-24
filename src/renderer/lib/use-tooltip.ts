/**
 * Themed tooltip: shared registry, guards, and anchor tracking.
 *
 * Three properties are load-bearing and must not be "simplified" away:
 *
 *  1. **Only one tooltip is on screen at once.** A pointer moving between two
 *     adjacent buttons would otherwise paint both during the swap, so a slot
 *     claims the singleton and hides whatever held it.
 *
 *  2. **The guards are installed once for the whole window**, not per trigger:
 *     blur, a hidden document, Escape, and a pointer that left its trigger all
 *     close whatever is visible. The pointer guard re-checks
 *     `anchor.matches(":hover")` because Chromium keeps `:hover` on the element
 *     under an idle pointer — a pointer that never left the window is not a
 *     leave event.
 *
 *  3. **A detached anchor closes the tooltip**, with a short grace window so a
 *     list re-order that remounts rows does not blink it. A row that just left
 *     the list can never fire `pointerleave`, so the anchor is polled instead.
 *
 * Timers are `window.setTimeout` handles rather than reactive state: they are
 * cancelled from event handlers outside any component effect.
 */
import { onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";

/** Tooltip layout, in viewport coordinates. */
export type TooltipPosition = { left: number; top: number; bottom: number };

/** Delay before a hovered trigger shows its tooltip. */
export const TOOLTIP_SHOW_DELAY_MS = 300;
/** Grace window before a tooltip hides once its trigger is left. */
export const TOOLTIP_HIDE_DELAY_MS = 100;
/** How long a detached anchor may stay gone before its tooltip closes. */
const ANCHOR_RECONNECT_GRACE_MS = 250;
/** Polling interval for the detached-anchor check. */
const ANCHOR_POLL_MS = 200;

type TooltipSlot = {
  slotId: symbol;
  hide: () => void;
  anchor: HTMLElement | null;
  /**
   * True only while the trigger is hovered, so a keyboard-revealed tooltip is
   * never closed by an unrelated mouse movement.
   */
  hovered: boolean;
};

let visibleTooltip: TooltipSlot | null = null;

function claimTooltipSlot(slot: TooltipSlot) {
  if (visibleTooltip && visibleTooltip.slotId !== slot.slotId) {
    visibleTooltip.hide();
  }
  visibleTooltip = slot;
}

function releaseTooltipSlot(slotId: symbol) {
  if (visibleTooltip?.slotId === slotId) visibleTooltip = null;
}

/** One listener set for the whole window instead of one per trigger. */
let installedTooltipGuards = false;

function ensureTooltipGuards() {
  if (installedTooltipGuards) return;
  installedTooltipGuards = true;
  window.addEventListener("blur", () => visibleTooltip?.hide());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) visibleTooltip?.hide();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") visibleTooltip?.hide();
  });
  document.addEventListener(
    "pointermove",
    (event) => {
      const tooltip = visibleTooltip;
      // A tooltip revealed by keyboard focus has no pointer to follow.
      if (!tooltip?.hovered || !tooltip.anchor) return;
      const anchor = tooltip.anchor;
      if (anchor.contains(event.target as Node)) return;
      // Chromium keeps :hover on the element under an idle pointer, so a
      // pointer that never left the window is not a leave event.
      if (anchor.matches(":hover")) return;
      const rect = anchor.getBoundingClientRect();
      const margin = 4;
      const inside =
        event.clientX >= rect.left - margin &&
        event.clientX <= rect.right + margin &&
        event.clientY >= rect.top - margin &&
        event.clientY <= rect.bottom + margin;
      if (!inside) tooltip.hide();
    },
    true,
  );
}

export type UseTooltipOptions = {
  /** The tooltip text; an empty label disables the tooltip entirely. */
  label: Ref<string> | (() => string);
  /** A disabled trigger does not show its tooltip unless `showWhenDisabled`. */
  disabled?: Ref<boolean> | (() => boolean);
  delayMs?: number;
  hideDelayMs?: number;
  /**
   * `TooltipButton` passes true: a disabled button still explains itself.
   * `Tooltip` passes false: a disabled anchor shows nothing.
   */
  showWhenDisabled?: boolean;
};

/**
 * Tooltip state and trigger bindings for one anchor element.
 *
 * The returned handlers are plain functions, so they bind to any element the
 * caller renders — `Tooltip` wraps a span, `TooltipButton` a button.
 */
export function useTooltip<T extends HTMLElement>(options: UseTooltipOptions) {
  const readLabel = () =>
    typeof options.label === "function" ? options.label() : options.label.value;
  const readDisabled = () =>
    options.disabled === undefined
      ? false
      : typeof options.disabled === "function"
        ? options.disabled()
        : options.disabled.value;
  const delayMs = options.delayMs ?? TOOLTIP_SHOW_DELAY_MS;
  const hideDelayMs = options.hideDelayMs ?? TOOLTIP_HIDE_DELAY_MS;
  const showWhenDisabled = options.showWhenDisabled ?? false;

  const anchorRef = shallowRef<T | null>(null);
  // Stable identity for the single-visible-tooltip registry, so a render that
  // re-creates the hide callback still owns the same slot.
  const slotId = Symbol("ui-tooltip");
  let showTimer: number | null = null;
  let hideTimer: number | null = null;
  let anchorTimer: number | null = null;
  let visible = false;
  let hovered = false;
  let focused = false;
  let dismissed = false;

  const open = ref(false);
  const position = ref<TooltipPosition | null>(null);

  const clearShowTimer = () => {
    if (showTimer === null) return;
    window.clearTimeout(showTimer);
    showTimer = null;
  };

  const clearHideTimer = () => {
    if (hideTimer === null) return;
    window.clearTimeout(hideTimer);
    hideTimer = null;
  };

  const clearAnchorTimer = () => {
    if (anchorTimer === null) return;
    window.clearInterval(anchorTimer);
    anchorTimer = null;
  };

  const setTooltipVisible = (next: boolean) => {
    if (next === visible) return;
    visible = next;
    if (next) {
      claimTooltipSlot({
        slotId,
        hide,
        anchor: anchorRef.value,
        hovered,
      });
    } else {
      releaseTooltipSlot(slotId);
    }
    open.value = next;
  };

  /**
   * A hide from any source — leaving the trigger, Escape, a window blur — also
   * cancels a show that has not painted yet, so nothing appears after.
   */
  function hide() {
    clearShowTimer();
    releaseTooltipSlot(slotId);
    setTooltipVisible(false);
  }

  const isActive = () =>
    Boolean(readLabel()) && (hovered || focused) && !dismissed && (showWhenDisabled || !readDisabled());

  /** Re-arm the show/hide timers from the current trigger state. */
  const syncTimers = () => {
    clearShowTimer();
    clearHideTimer();
    if (isActive()) {
      if (!visible) {
        showTimer = window.setTimeout(() => {
          showTimer = null;
          setTooltipVisible(true);
        }, Math.max(0, delayMs));
      }
    } else if (visible) {
      hideTimer = window.setTimeout(() => {
        hideTimer = null;
        setTooltipVisible(false);
      }, Math.max(0, hideDelayMs));
    }
  };

  const updatePosition = () => {
    const rect = anchorRef.value?.getBoundingClientRect();
    if (!rect) return;
    position.value = {
      left: rect.left + rect.width / 2,
      top: rect.top - 8,
      bottom: rect.bottom + 8,
    };
  };

  /**
   * Keep the painted tooltip attached to a live anchor. A detached anchor closes
   * it unless the same node is re-inserted within the grace window.
   */
  const watchAnchor = () => {
    clearAnchorTimer();
    if (!visible) {
      position.value = null;
      return;
    }
    const anchor = anchorRef.value;
    if (!anchor) {
      setTooltipVisible(false);
      return;
    }
    updatePosition();
    let wasConnected = anchor.isConnected;
    let disconnectedAt = wasConnected ? 0 : performance.now();
    if (!wasConnected) setTooltipVisible(false);
    anchorTimer = window.setInterval(() => {
      const connected = anchor.isConnected;
      if (connected === wasConnected) return;
      wasConnected = connected;
      if (connected) {
        if (performance.now() - disconnectedAt <= ANCHOR_RECONNECT_GRACE_MS) {
          setTooltipVisible(true);
        }
        return;
      }
      disconnectedAt = performance.now();
      setTooltipVisible(false);
    }, ANCHOR_POLL_MS);
  };

  /** Re-run the position pass on viewport changes while the tooltip is up. */
  const onViewportChange = () => updatePosition();
  let listeningForViewport = false;
  const startViewportListeners = () => {
    if (listeningForViewport) return;
    listeningForViewport = true;
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
  };
  const stopViewportListeners = () => {
    if (!listeningForViewport) return;
    listeningForViewport = false;
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onViewportChange, true);
  };

  // The visibility transition owns the anchor poll and the viewport listeners:
  // both only matter while a tooltip is on screen.
  let lastVisible = false;
  const syncVisibilitySideEffects = () => {
    if (visible === lastVisible) return;
    lastVisible = visible;
    if (visible) {
      startViewportListeners();
      watchAnchor();
    } else {
      stopViewportListeners();
      clearAnchorTimer();
      position.value = null;
    }
  };

  ensureTooltipGuards();

  const onPointerEnter = () => {
    dismissed = false;
    hovered = true;
    syncTimers();
  };

  const onPointerLeave = () => {
    hovered = false;
    syncTimers();
  };

  const onFocus = () => {
    focused = true;
    syncTimers();
  };

  const onBlur = () => {
    focused = false;
    syncTimers();
  };

  const dismiss = () => {
    dismissed = true;
    if (visible) setTooltipVisible(false);
    syncVisibilitySideEffects();
  };

  /**
   * A disabled trigger drops its hover/focus state instead of keeping a tooltip
   * latched on a control the pointer can no longer enter.
   */
  const onDisabledChange = (disabled: boolean) => {
    if (!disabled) return;
    hovered = false;
    focused = false;
    if (visible) setTooltipVisible(false);
    syncVisibilitySideEffects();
  };

  // The visibility transition owns the anchor poll and the viewport listeners,
  // so they follow `open` instead of being driven from the call site.
  watch(open, () => syncVisibilitySideEffects());

  // A disabled trigger, or a label that arrives late (i18n resolving after the
  // first paint), changes whether a tooltip is allowed at all.
  watch(
    [() => readLabel(), () => readDisabled()],
    ([, disabled]) => {
      onDisabledChange(disabled);
      syncTimers();
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    clearShowTimer();
    clearHideTimer();
    clearAnchorTimer();
    stopViewportListeners();
    visible = false;
    releaseTooltipSlot(slotId);
  });

  return {
    anchorRef,
    open,
    position,
    onPointerEnter,
    onPointerLeave,
    onFocus,
    onBlur,
    dismiss,
  };
}
