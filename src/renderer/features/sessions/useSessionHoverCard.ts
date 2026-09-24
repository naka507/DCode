import { onScopeDispose, ref, watchEffect, type Ref } from "vue";
import type { SessionSummary } from "@dcode/shared";

export type SessionHoverCardData = {
  session: SessionSummary;
  target: HTMLElement;
  temporary: boolean;
  space: string;
  branch?: string;
};

/**
 * Hover-card scheduling for one sidebar session row.
 *
 * The three timers and the pending request are plain module-local state, not
 * reactive: they are driven from pointer events and cleared from the global
 * listeners. The `useCallback` identities are plain functions (no memo is
 * needed), and the deps-less effect that re-ran after every render to hide a
 * card whose target had left the document becomes a `watchEffect` that
 * re-checks whenever the card changes.
 */
export function useSessionHoverCard(): {
  card: Ref<SessionHoverCardData | null>;
  show: (request: SessionHoverCardData) => void;
  hide: () => void;
  scheduleHide: () => void;
  keepVisible: () => void;
} {
  const card = ref<SessionHoverCardData | null>(null);
  let request: SessionHoverCardData | null = null;
  let timer: number | undefined;
  let dismissTimer: number | undefined;

  function cancelPending() {
    request = null;
    window.clearTimeout(timer);
    timer = undefined;
  }

  function cancelDismiss() {
    window.clearTimeout(dismissTimer);
    dismissTimer = undefined;
  }

  function hide() {
    cancelDismiss();
    cancelPending();
    card.value = null;
  }

  function scheduleHide() {
    cancelDismiss();
    dismissTimer = window.setTimeout(() => {
      dismissTimer = undefined;
      hide();
    }, 160);
  }

  function show(next: SessionHoverCardData) {
    if (request?.target === next.target) return;
    cancelDismiss();
    cancelPending();
    card.value = null;
    request = next;
    timer = window.setTimeout(() => {
      timer = undefined;
      // The pointer may have left, the row may have unmounted, or the window
      // may have been hidden while the delay ran.
      if (request !== next || !next.target.isConnected || document.hidden) return;
      card.value = next;
    }, 500);
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") hide();
  };
  const onVisibility = () => {
    if (document.hidden) hide();
  };

  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  window.addEventListener("pointerdown", hide);
  window.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);

  onScopeDispose(() => {
    cancelDismiss();
    cancelPending();
    window.removeEventListener("scroll", hide, true);
    window.removeEventListener("resize", hide);
    window.removeEventListener("pointerdown", hide);
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVisibility);
  });

  // A reused card must never outlive the row it points at.
  watchEffect(() => {
    const current = card.value;
    if (current && !current.target.isConnected) hide();
  });

  return { card, show, hide, scheduleHide, keepVisible: cancelDismiss };
}
