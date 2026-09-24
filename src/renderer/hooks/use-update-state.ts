import { onScopeDispose, ref, type Ref } from "vue";
import type { UpdateState } from "@dcode/shared";
import { api } from "../lib/api";

/**
 * Live view of the app-update state: seeds from the main process snapshot,
 * then follows `updatesState` push events. Null until the bridge answers
 * (or forever in browser-only harnesses without a preload).
 *
 * The `mounted` flag is replaced by the scope itself — a push that arrives after
 * dispose must not write, and `onScopeDispose` unsubscribes the listener in the
 * same step the cleanup does.
 */
export function useUpdateState(): Ref<UpdateState | null> {
  const state = ref<UpdateState | null>(null);

  let mounted = true;
  api
    .updatesGetState()
    .then((snapshot) => {
      // A push that already arrived wins over the seed; the snapshot is only
      // the starting point, never a step backwards.
      if (mounted) state.value = state.value ?? snapshot;
    })
    .catch(() => undefined);
  const off = api.onUpdateState((next) => {
    state.value = next;
  });

  onScopeDispose(() => {
    mounted = false;
    off();
  });

  return state;
}
