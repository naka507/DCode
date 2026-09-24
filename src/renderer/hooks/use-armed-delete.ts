import { ref, watch, type Ref } from "vue";

/** How long an armed delete stays armed before it disarms itself. */
export const ARMED_DELETE_MS = 3200;

/**
 * A delete that needs two clicks. The first click arms the action and the
 * caller relabels it; the arm expires on its own so a surface never stays one
 * stray click away from a permanent delete. The armed key is opaque to the
 * hook, so a caller can arm either a row or one item of a row menu.
 *
 * The arm timer is installed by a `watch` on `armed` and dropped by its
 * `onCleanup`, keyed on the armed key and `timeoutMs` — the same "a new arm
 * replaces the old timer" contract.
 */
export function useArmedDelete(timeoutMs: number = ARMED_DELETE_MS): {
  armed: Ref<string | null>;
  setArmed: (value: string | null) => void;
} {
  const armed = ref<string | null>(null);

  watch(armed, (value, _previous, onCleanup) => {
    if (!value) return;
    const timer = window.setTimeout(() => {
      armed.value = null;
    }, timeoutMs);
    onCleanup(() => window.clearTimeout(timer));
  });

  /** An explicit key, or `null` to disarm. */
  function setArmed(value: string | null) {
    armed.value = value;
  }

  return { armed, setArmed };
}
