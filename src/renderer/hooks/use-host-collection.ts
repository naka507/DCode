/**
 * Loads a host-backed collection and reloads it whenever a plugin changes or
 * the host comes back (the agent capability pages: skills, MCP servers,
 * subagents).
 *
 * Skeletons belong to the first paint only; later reloads dim the list instead
 * of tearing it down, so toggling a row never blinks the page away. Every
 * request is stamped with a counter and only the newest one may write state,
 * so a slow fetch for the previous project can never land after the current
 * one and overwrite it.
 *
 * `useCallback`/`useEffect` become a plain function plus
 * `onMounted`/`onUnmounted`, with `data` and `setData` reading/writing a ref.
 */
import { onMounted, onUnmounted, ref, type Ref } from "vue";
import { api } from "../lib/api";

export type HostCollection<T> = {
  data: Ref<T>;
  setData: (next: T | ((current: T) => T)) => void;
  /** First paint only: the page shows skeletons until the first load lands. */
  loading: Ref<boolean>;
  /** Later reloads keep the rows on screen and only dim them. */
  refreshing: Ref<boolean>;
  reload: () => Promise<void>;
};

export function useHostCollection<T>(
  fetcher: () => Promise<T>,
  empty: T,
  onError: (error: unknown) => void,
): HostCollection<T> {
  const data = ref<T>(empty) as Ref<T>;
  const loading = ref(true);
  const refreshing = ref(false);
  let hydrated = false;
  let latestRequest = 0;

  const setData = (next: T | ((current: T) => T)) => {
    data.value =
      typeof next === "function"
        ? (next as (current: T) => T)(data.value)
        : next;
  };

  async function reload() {
    const requestId = ++latestRequest;
    const isCurrent = () => requestId === latestRequest;
    if (hydrated) refreshing.value = true;
    else loading.value = true;
    try {
      const next = await fetcher();
      if (!isCurrent()) return;
      data.value = next;
      hydrated = true;
    } catch (error) {
      if (!isCurrent()) return;
      onError(error);
      data.value = empty;
    } finally {
      if (isCurrent()) {
        loading.value = false;
        refreshing.value = false;
      }
    }
  }

  let offPluginChanged = () => {};
  let offHostStatus = () => {};
  onMounted(() => {
    void reload();
    offPluginChanged = api.onPluginChanged(() => void reload());
    offHostStatus = api.onHostStatus((status) => {
      if (status.ok) void reload();
    });
  });
  onUnmounted(() => {
    offPluginChanged();
    offHostStatus();
    // Retire any request still in flight so it cannot write after unmount
    // or after the fetcher (e.g. the selected project) has changed.
    latestRequest += 1;
  });

  return { data, setData, loading, refreshing, reload };
}
