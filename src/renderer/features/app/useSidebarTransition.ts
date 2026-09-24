/**
 * Sidebar collapse/expand transition phase.
 *
 * The phase is a transient marker
 * the shell puts on the sidebar so the stylesheet's `sidebar-in` / `sidebar-out`
 * animations run on a collapse or expand, and is cleared once the animation is
 * over — by `animationend` or by the timeout, whichever lands first.
 *
 * `nextSidebarTransition` is framework-free: the shell's transition table is the
 * contract, not the way it is stored.
 */
import { computed, type MaybeRefOrGetter, shallowRef, toValue, watch } from "vue";

export type SidebarTransition = {
  collapsed: boolean;
  presented: boolean;
  phase: "idle" | "entering" | "exiting";
};

/**
 * Fallback window for clearing the phase, in ms. Deliberately longer than both
 * `sidebar-in` (200ms) and `sidebar-out` (150ms) so the animation handler wins
 * the race; this only fires when no `animationend` arrives at all.
 */
const SIDEBAR_TRANSITION_FALLBACK_MS = 240;

/**
 * Next transition state for a collapse/expand change.
 *
 * Returns `previous` unchanged when neither input moved, so the caller can
 * compare by reference and skip a commit. A phase is only raised when the
 * sidebar was already on screen: the first paint has nothing to animate from.
 */
export function nextSidebarTransition(
  previous: SidebarTransition,
  collapsed: boolean,
  presented: boolean,
): SidebarTransition {
  if (previous.collapsed === collapsed && previous.presented === presented) return previous;
  const phase =
    presented && previous.presented && previous.collapsed !== collapsed
      ? collapsed
        ? "exiting"
        : "entering"
      : "idle";
  return { collapsed, presented, phase };
}

export function useSidebarTransition(
  collapsed: MaybeRefOrGetter<boolean>,
  presented: MaybeRefOrGetter<boolean>,
) {
  // `shallowRef` and the `===` checks below give identity comparisons: a commit
  // that changes nothing must not churn the ref, because the timer and the
  // animation handler both bail out on reference equality.
  const transition = shallowRef<SidebarTransition>({
    collapsed: toValue(collapsed),
    presented: toValue(presented),
    phase: "idle",
  });

  const current = computed(() =>
    nextSidebarTransition(transition.value, toValue(collapsed), toValue(presented)),
  );

  // The derived value is adopted during render, i.e. before the
  // browser painted. `flush: "sync"` keeps that ordering: the class the
  // stylesheet animates is on the element in the same tick as the input change.
  watch(
    current,
    (next) => {
      if (next !== transition.value) transition.value = next;
    },
    { immediate: true, flush: "sync" },
  );

  // The phase is transient. The timeout is the fallback for a missing or
  // suppressed `animationend` (reduced motion, a hidden tab); `onCleanup` drops
  // it as soon as the phase changes again, matching the effect's teardown.
  watch(
    current,
    (next, _previous, onCleanup) => {
      if (next.phase === "idle") return;
      const timer = window.setTimeout(() => {
        if (transition.value === next) transition.value = { ...next, phase: "idle" };
      }, SIDEBAR_TRANSITION_FALLBACK_MS);
      onCleanup(() => window.clearTimeout(timer));
    },
    { immediate: true },
  );

  const handleSidebarAnimationEnd = (event: AnimationEvent) => {
    if (event.target !== event.currentTarget) return;
    const next = current.value;
    const expected = next.phase === "entering" ? "sidebar-in" : "sidebar-out";
    if (next.phase === "idle" || !event.animationName.startsWith(expected)) return;
    if (transition.value === next) transition.value = { ...next, phase: "idle" };
  };

  return {
    sidebarEntering: computed(() => current.value.phase === "entering"),
    sidebarExiting: computed(() => current.value.phase === "exiting"),
    handleSidebarAnimationEnd,
  };
}
