/**
 * Live model discovery for the provider forms.
 *
 * The AI service itself is the authority on which models it serves, so this
 * composable asks the service's own endpoint (through `api.listProviderModels`)
 * while the form is edited. models.dev only enriches what came back; the host
 * reports where the list originated through `source`.
 *
 * The `useProviderModels` composable. It stays a
 * plain `.ts` composable beside its two call sites
 * (`ProviderSetupDialog.vue`, `VendorAccountDialog.vue`).
 *
 * Deliberate choices, all consequences of setup running once:
 *
 *  1. **The three arguments became one `params` getter.** The earlier version re-ran the hook
 *     body on every render, so `active`, `form` and `editingProvider` were read
 *     fresh each time. A Vue composable is called once from `setup`, so the
 *     same freshness is expressed by calling `params()` wherever an argument was read
 *     an argument: the debounce watch, `run`, `reload` and `canReload` all read
 *     the live values, so a keystroke or a service change is still picked up.
 *     The call sites therefore pass `() => ({ active, baseUrl, apiKey, apiStyle,
 *     headers, providerId })`.
 *  2. **`useState` → a single `ref`, exposed through getters.** `discovery` is
 *     handed straight to `ModelSelectionPanes` as a prop, so its fields have to
 *     read as plain values in a template (a nested `Ref` would not unwrap);
 *     each getter reads the state ref, which the child's render effect tracks.
 *  3. **`useEffect` → `watch(., { immediate: true })`.** The dependency array
 *     becomes the watched tuple, so the debounce is rescheduled exactly when
 *     the dependency changes, and the `clearTimeout` cleanup is the
 *     watch's `onCleanup` (which Vue also runs when the component unmounts).
 *  4. **The "latest values" refs are plain `let` bindings.** `paramsRef`,
 *     `modelsRef` and `requestSeq` were `useRef`s only so a debounced callback
 *     could see the latest values; nothing rendered them.
 *  5. **`canReload` is a getter, not a plain field**, so it re-evaluates on each
 *     read the way the per-render computation did.
 */
import { ref, watch } from "vue";
import type { ModelInfo } from "@dcode/shared";
import { api } from "../../lib/api";

/** Where the returned list came from, as reported by the host. */
export type ProviderModelsSource = "cache" | "remote" | "catalog" | "fallback";

export type ProviderModelsState = {
  status: "idle" | "loading" | "ready" | "error";
  models: ModelInfo[];
  /** Message from the failed live call; cached rows stay visible alongside it. */
  error?: string;
  source?: ProviderModelsSource;
};

export type ProviderModelsDiscovery = ProviderModelsState & {
  /** Probe the live endpoint now. Skips debounce and the cache-first paint. */
  reload: () => void;
  /**
   * True when a live probe can start now. Idle-with-a-valid-URL (the edit
   * debounce) is included so Fetch list can skip that window.
   */
  canReload: boolean;
};

/** The live values the form supplies, read on every access. */
export type ProviderModelsParams = {
  /** False while the add-path is still waiting for a key. */
  active: boolean;
  baseUrl: string;
  apiKey: string;
  apiStyle: string;
  headers?: Record<string, string>;
  /** Set when an existing provider row is being edited. */
  providerId?: string;
};

/** Keystroke settling window before the service is contacted. */
const FETCH_DEBOUNCE_MS = 600;

const IDLE: ProviderModelsState = { status: "idle", models: [] };

function canDiscover(baseUrl: string): boolean {
  try {
    new URL(baseUrl.trim());
  } catch {
    return false;
  }
  // Discovery is also useful for local/no-auth gateways, so an API key is never
  // required here. A provider can still answer with an auth error, which leaves
  // the custom-model path available. Named add-path gating happens at the call
  // site via `active`.
  return true;
}

/**
 * Discover the models a service publishes while its form is edited.
 *
 * Debounced on baseUrl/apiKey/apiStyle. Loading is not painted until that
 * window elapses, so typing a key or picking a service does not re-render the
 * panes on every change. A saved provider paints its cached list first and
 * then refreshes live; the stored secret is reused when no key is typed (the
 * main process reads the keychain for `providerId`). A header action can probe
 * immediately without waiting for that window or painting cache first.
 */
export function useProviderModels(
  params: () => ProviderModelsParams,
): ProviderModelsDiscovery {
  const state = ref<ProviderModelsState>(IDLE);
  // Only the newest request may commit: a slow reply from an older keystroke
  // must never overwrite a newer result.
  let requestSeq = 0;
  let endpointRef: string | null = null;
  // The models currently on screen, so a reload keeps them painted while the
  // new answer is in flight. The same value lives in `modelsRef`.
  let modelsRef: ModelInfo[] = state.value.models;

  const setState = (next: ProviderModelsState) => {
    state.value = next;
    modelsRef = next.models;
  };

  const run = async (requestId: number, options?: { skipCache?: boolean }) => {
    const {
      active: isActive,
      baseUrl: url,
      apiKey: key,
      apiStyle: style,
      headers: hdrs,
      providerId: id,
    } = params();
    if (requestSeq !== requestId) return;
    if (!isActive || !canDiscover(url)) {
      setState(IDLE);
      return;
    }
    setState({ status: "loading", models: modelsRef });

    let cachedModels: ModelInfo[] = options?.skipCache ? modelsRef : [];
    if (id && !options?.skipCache) {
      try {
        const cached = await api.listProviderModels({
          providerId: id,
          source: "cache",
        });
        if (requestSeq !== requestId) return;
        cachedModels = cached.models;
        if (cachedModels.length > 0) {
          // Paint the known list instantly; the live answer replaces it.
          setState({
            status: "loading",
            models: cachedModels,
            source: cached.source,
          });
        }
      } catch {
        // Live discovery remains available when the local cache read fails.
      }
    }

    try {
      // No `source` field: that is what selects the live branch in the host
      // handler, which asks the service first and models.dev only after.
      const result = await api.listProviderModels({
        ...(id ? { providerId: id } : {}),
        baseUrl: url.trim(),
        ...(key ? { apiKey: key } : {}),
        apiStyle: style,
        ...(Object.keys(hdrs ?? {}).length > 0 ? { headers: hdrs } : {}),
      });
      if (requestSeq !== requestId) return;
      if (result.models.length > 0) {
        setState({
          status: "ready",
          models: result.models,
          source: result.source,
          ...(result.error ? { error: result.error } : {}),
        });
      } else {
        // An empty live result keeps the cached rows usable and reports why.
        setState({
          status: "error",
          models: cachedModels,
          source: result.source,
          ...(result.error ? { error: result.error } : {}),
        });
      }
    } catch (cause) {
      if (requestSeq !== requestId) return;
      setState({
        status: "error",
        models: cachedModels,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  watch(
    () => {
      const current = params();
      return [
        current.active,
        current.baseUrl,
        current.apiKey,
        current.apiStyle,
        JSON.stringify(current.headers ?? {}),
        current.providerId,
      ] as const;
    },
    (_next, _previous, onCleanup) => {
      const { active, baseUrl, apiStyle, apiKey, providerId } = params();
      const endpoint = `${baseUrl.trim()}|${apiStyle}`;
      const first = endpointRef === null;
      const endpointChanged = !first && endpointRef !== endpoint;
      endpointRef = endpoint;

      if (!active || !canDiscover(baseUrl)) {
        requestSeq += 1;
        setState(IDLE);
        return;
      }

      const requestId = ++requestSeq;
      if (endpointChanged) setState(IDLE);

      // An existing provider opens with a known-good config — fetch right away
      // unless the endpoint itself just changed.
      const immediate = !!providerId && !apiKey && !endpointChanged;
      const timer = setTimeout(
        () => void run(requestId),
        immediate ? 0 : FETCH_DEBOUNCE_MS,
      );
      onCleanup(() => clearTimeout(timer));
    },
    { immediate: true },
  );

  const reload = () => {
    const current = params();
    if (!current.active || !canDiscover(current.baseUrl)) return;
    const requestId = ++requestSeq;
    void run(requestId, { skipCache: true });
  };

  return {
    get status() {
      return state.value.status;
    },
    get models() {
      return state.value.models;
    },
    get error() {
      return state.value.error;
    },
    get source() {
      return state.value.source;
    },
    reload,
    get canReload() {
      const current = params();
      return (
        current.active &&
        canDiscover(current.baseUrl) &&
        state.value.status !== "loading"
      );
    },
  };
}
