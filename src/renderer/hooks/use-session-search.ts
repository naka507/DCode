/**
 * Transient session-search state and the debounced search it drives.
 *
 * Design notes:
 *
 *   1. The `zustand` store becomes module-scope refs, which is the same
 *      lifetime (the query survives closing the palette and never goes to
 *      disk) and stays tracked for a component that reads it.
 *   2. `useSyncExternalStore(controller.subscribe, controller.getSnapshot)`
 *      becomes a `shallowRef` the controller subscription writes. The
 *      controller publishes a fresh state object on every change, so a shallow
 *      ref is enough and avoids deep-proxying the hits.
 *   3. The effect becomes a `watch` whose cleanup is `onCleanup`, so the 150ms
 *      debounce and the in-flight cancel run in that order.
 */
import {
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue";
import { api } from "../lib/api";
import { SessionSearchController } from "../lib/session-search";

/** Transient search state survives closing the palette, never goes to disk. */
const sessionSearchQuery = ref("");

export function useSessionSearchState() {
  return {
    query: sessionSearchQuery,
    setQuery: (next: string) => {
      sessionSearchQuery.value = next;
    },
  };
}

export function useSessionSearch(
  open: MaybeRefOrGetter<boolean>,
  query: MaybeRefOrGetter<string>,
) {
  const controller = new SessionSearchController(api.searchSessions);
  const state = shallowRef(controller.getSnapshot());
  onScopeDispose(
    controller.subscribe(() => {
      state.value = controller.getSnapshot();
    }),
  );
  const normalized = computed(() => toValue(query).trim());

  watch(
    [() => toValue(open), normalized],
    ([isOpen, current], _previous, onCleanup) => {
      if (!isOpen) return;
      controller.reset(current);
      const timer = window.setTimeout(() => void controller.load(), 150);
      onCleanup(() => {
        window.clearTimeout(timer);
        controller.cancel();
      });
    },
    { immediate: true },
  );

  return {
    hits: computed(() =>
      state.value.query === normalized.value ? state.value.hits : [],
    ),
    nextOffset: computed(() =>
      state.value.query === normalized.value ? state.value.nextOffset : null,
    ),
    error: computed(() =>
      state.value.query === normalized.value ? state.value.error : undefined,
    ),
    loading: computed(
      () =>
        Boolean(normalized.value) &&
        (state.value.query !== normalized.value || state.value.loading),
    ),
    loadMore: () => controller.loadMore(),
    retry: () => controller.retry(),
  };
}
