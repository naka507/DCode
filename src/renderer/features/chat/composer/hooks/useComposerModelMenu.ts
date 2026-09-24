/**
 * Composer model/reasoning menu controller.
 *
 * Design notes, in the order the choices matter:
 *
 *   - `useState` -> `ref`, `useMemo` -> `computed`, `useRef` -> `ref` (the
 *     element refs are read through `.value`).
 *   - The zustand selectors (`useAppStore((s) => s.providers)`, and
 *     one per action) become `computed` projections over
 *     `store.appState?.<field>`, and the actions are read off `store.appState`
 *     at the call site. `appState` is a shallow ref, so a projection tracks the
 *     commit instead of the object identity.
 *   - `useEffect` -> `watch`, with the same dependency sets carried over:
 *     each effect re-runs on the same set of changes. `flatModelsKey`
 *     stays in the model-highlight effect because a new model list has to reset
 *     the highlight even when its length did not change.
 *   - The prop-shaped options are `MaybeRefOrGetter` and are read through
 *     `toValue()` inside each callback, so they stay as fresh as the props they
 *     track. A plain value, a `ref` and a `computed` all satisfy that, so no
 *     call site loses freshness.
 *   - The native keyboard event carries the fields the IME guard needs
 *     (`event.isComposing`, `event.keyCode`) directly.
 *   - `controlsBlocked` stays on the returned controller, as a `computed` of
 *     the option, because `ComposerModelPicker` reads it from there. Each state
 *     cell is returned as a ref rather than a plain value, because a Vue
 *     template reads a ref that came out of a composable without `.value` —
 *     the same spelling the markup uses.
 */
import {
  computed,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";
import type { Mode, ProviderPublic, SessionThinkingLevel } from "@dcode/shared";
import {
  initialThinkingLevelForBinding,
  modelIdsMatch,
} from "@dcode/shared";

import { useAppStore } from "../../../../stores/app-store";
import {
  composerModelMatchesQuery,
  composerModelsForProvider,
  composerProviderDisplayName,
  composerProviderSearchText,
} from "../../../../lib/composer-models";
import { providerThinkingLevels } from "../../../../lib/session-thinking";
import {
  sessionThinkingMenuLevels,
  thinkingLevelForProvider,
  thinkingProviderForModel,
  type ComposerMenuView,
} from "../model";
import { createLatestCommitQueue } from "../thinking-commit-queue";

type UseComposerModelMenuOptions = {
  mode: MaybeRefOrGetter<Mode>;
  activeSessionId: MaybeRefOrGetter<string | null | undefined>;
  provider: MaybeRefOrGetter<ProviderPublic | undefined>;
  modelId: MaybeRefOrGetter<string | undefined>;
  thinkingProvider: MaybeRefOrGetter<ProviderPublic | null | undefined>;
  thinkingLevel: MaybeRefOrGetter<SessionThinkingLevel>;
  controlsBlocked: MaybeRefOrGetter<boolean>;
};

export type ComposerModelGroup = {
  provider: ProviderPublic;
  providerDisplayName: string;
  providerSearchText: string;
  models: ReturnType<typeof composerModelsForProvider>;
};

export type ComposerModelMenuController = {
  open: Ref<boolean>;
  setOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  view: Ref<ComposerMenuView>;
  query: Ref<string>;
  setQuery: (value: string) => void;
  modelHighlight: Ref<number>;
  setModelHighlight: (value: number) => void;
  thinkingHighlight: Ref<number>;
  setThinkingHighlight: (value: number) => void;
  rootMenuRef: Ref<HTMLDivElement | null>;
  modelSearchRef: Ref<HTMLInputElement | null>;
  modelListRef: Ref<HTMLDivElement | null>;
  thinkingListRef: Ref<HTMLDivElement | null>;
  modelGroups: ComputedRef<ComposerModelGroup[]>;
  flatModels: ComputedRef<
    Array<{ provider: ProviderPublic; model: ComposerModelGroup["models"][number] }>
  >;
  thinkingMenuLevels: ComputedRef<SessionThinkingLevel[]>;
  showView: (nextView: ComposerMenuView) => void;
  selectModel: (candidate: ProviderPublic, nextModelId: string) => Promise<void>;
  commitThinkingLevel: (level: SessionThinkingLevel) => Promise<boolean>;
  selectThinkingLevel: (level: SessionThinkingLevel) => Promise<void>;
  onMenuKeyDown: (event: KeyboardEvent) => void;
  controlsBlocked: ComputedRef<boolean>;
};

export function useComposerModelMenu({
  mode,
  activeSessionId,
  provider,
  modelId,
  thinkingProvider: resolvedThinkingProvider,
  thinkingLevel,
  controlsBlocked,
}: UseComposerModelMenuOptions): ComposerModelMenuController {
  const store = useAppStore();
  const providers = computed(() => store.appState?.providers ?? []);
  const providerModels = computed(() => store.appState?.providerModels ?? {});
  const open = ref(false);
  const view = ref<ComposerMenuView>("root");
  const query = ref("");
  const modelHighlight = ref(-1);
  const thinkingHighlight = ref(-1);
  const rootMenuRef = ref<HTMLDivElement | null>(null);
  const modelSearchRef = ref<HTMLInputElement | null>(null);
  const modelListRef = ref<HTMLDivElement | null>(null);
  const thinkingListRef = ref<HTMLDivElement | null>(null);
  /*
    The latest-wins queue outlives any single drag: a setup runs once per
    component instance, so it is created here rather than behind a lazily
    filled ref. `send` reads the store and the option getters at call time, so
    a queued level is persisted against the binding that is current when the
    write starts — the callbacks read the option getters at call time instead of
    closing over props.
  */
  const thinkingQueue = createLatestCommitQueue<SessionThinkingLevel>({
    send: async (level) => {
      await store.appState?.configureActiveSession({
        mode: toValue(mode),
        providerId: toValue(provider)?.id,
        modelId: toValue(modelId),
        thinkingLevel: level,
      });
    },
    onError: (error) => {
      store.appState?.showToast(
        error instanceof Error ? error.message : String(error),
        { variant: "error" },
      );
    },
  });
  // The projection keeps this prop live for the returned controller, so it is
  // read on each render without turning the option into a ref.
  const controlsBlockedProjection = computed(() => toValue(controlsBlocked));

  const thinkingProvider = computed(() => {
    const selectedProvider = toValue(provider);
    return (
      toValue(resolvedThinkingProvider) ??
      thinkingProviderForModel(
        selectedProvider,
        toValue(modelId),
        selectedProvider ? providerModels.value[selectedProvider.id] : undefined,
      )
    );
  });
  const thinkingMenuLevels = computed<SessionThinkingLevel[]>(() => {
    const availableThinkingLevels = providerThinkingLevels(thinkingProvider.value);
    return sessionThinkingMenuLevels(availableThinkingLevels);
  });
  const modelGroups = computed<ComposerModelGroup[]>(() =>
    providers.value
      .filter(
        (candidate) =>
          candidate.enabled &&
          (candidate.hasSecret || candidate.authKind === "none"),
      )
      .map((candidate) => {
        const models = composerModelsForProvider(
          candidate,
          providerModels.value[candidate.id],
        );
        return {
          provider: candidate,
          providerDisplayName: composerProviderDisplayName(candidate),
          providerSearchText: composerProviderSearchText(candidate),
          models,
        };
      })
      .filter((group) => group.models.length > 0),
  );
  const queryNeedle = computed(() => query.value.trim().toLowerCase());
  const filteredModelGroups = computed(() =>
    queryNeedle.value
      ? modelGroups.value
          .map((group) => ({
            ...group,
            models: group.models.filter((model) =>
              composerModelMatchesQuery(
                model,
                group.providerSearchText,
                queryNeedle.value,
              ),
            ),
          }))
          .filter((group) => group.models.length > 0)
      : modelGroups.value,
  );
  const flatModels = computed(() =>
    filteredModelGroups.value.flatMap((group) =>
      group.models.map((model) => ({ provider: group.provider, model })),
    ),
  );
  const flatModelsKey = computed(() =>
    flatModels.value.map((entry) => `${entry.provider.id}:${entry.model.modelId}`).join("|"),
  );
  const activeFlatIndex = computed(() => {
    const selectedProviderId = toValue(provider)?.id;
    const selectedModelId = toValue(modelId);
    return flatModels.value.findIndex(
      (entry) =>
        entry.provider.id === selectedProviderId &&
        entry.model.modelId === selectedModelId,
    );
  });

  watch(
    [activeFlatIndex, () => flatModels.value.length, flatModelsKey, open, queryNeedle, view],
    () => {
      if (!open.value || view.value !== "model") return;
      modelHighlight.value = queryNeedle.value
        ? flatModels.value.length
          ? 0
          : -1
        : activeFlatIndex.value;
    },
  );

  watch([open, thinkingLevel, thinkingMenuLevels, view], () => {
    if (!open.value || view.value !== "thinking") return;
    const level = toValue(thinkingLevel);
    thinkingHighlight.value = level ? thinkingMenuLevels.value.indexOf(level) : -1;
  });

  watch([open, providers], () => {
    if (!open.value) return;
    for (const candidate of providers.value) {
      if (candidate.enabled && (candidate.hasSecret || candidate.authKind === "none")) {
        void store.appState?.loadProviderModels(candidate.id);
      }
    }
  });

  watch(open, () => {
    if (open.value) return;
    view.value = "root";
    query.value = "";
    modelHighlight.value = -1;
    thinkingHighlight.value = -1;
  });

  /*
    A pending level belongs to the binding it was dragged on. A session or
    model change invalidates the queue so an in-flight write cannot land a
    stale level on the new binding (the invalidation watches
    `activeSessionId, provider?.id, modelId`).
  */
  watch(
    [
      () => toValue(activeSessionId),
      () => toValue(provider)?.id,
      () => toValue(modelId),
    ],
    () => thinkingQueue.invalidate(),
  );

  watch(
    () => toValue(controlsBlocked),
    (blocked) => {
      if (!blocked) return;
      open.value = false;
      thinkingQueue.invalidate();
    },
  );

  watch([open, view], () => {
    if (!open.value) return;
    requestAnimationFrame(() => {
      if (view.value === "root") {
        rootMenuRef.value?.querySelector<HTMLButtonElement>("button")?.focus();
      }
      if (view.value === "model") modelSearchRef.value?.focus();
      if (view.value === "thinking") {
        thinkingListRef.value?.querySelector<HTMLButtonElement>("button")?.focus();
      }
      if (view.value === "model" && modelHighlight.value >= 0) {
        modelListRef.value
          ?.querySelector(`[data-model-index="${modelHighlight.value}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }
      if (view.value === "thinking" && thinkingHighlight.value >= 0) {
        thinkingListRef.value
          ?.querySelector(`[data-thinking-index="${thinkingHighlight.value}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }
    });
  });

  watch([modelHighlight, open, view], () => {
    if (!open.value || view.value !== "model" || modelHighlight.value < 0) return;
    modelListRef.value
      ?.querySelector(`[data-model-index="${modelHighlight.value}"]`)
      ?.scrollIntoView({ block: "nearest" });
  });

  watch([open, thinkingHighlight, view], () => {
    if (!open.value || view.value !== "thinking" || thinkingHighlight.value < 0) return;
    thinkingListRef.value
      ?.querySelector(`[data-thinking-index="${thinkingHighlight.value}"]`)
      ?.scrollIntoView({ block: "nearest" });
  });

  const showView = (nextView: ComposerMenuView) => {
    view.value = nextView;
    modelHighlight.value = -1;
    thinkingHighlight.value = -1;
    if (nextView !== "model") query.value = "";
  };

  const selectModel = async (candidate: ProviderPublic, nextModelId: string) => {
    thinkingQueue.invalidate();
    await thinkingQueue.idle();
    try {
      const nextModelProvider = thinkingProviderForModel(
        candidate,
        nextModelId,
        providerModels.value[candidate.id],
      );
      const nextBinding = candidate.models.find((entry) =>
        modelIdsMatch(entry.id, nextModelId),
      );
      const nextThinkingLevel = toValue(activeSessionId)
        ? thinkingLevelForProvider(nextModelProvider, toValue(thinkingLevel))
        : initialThinkingLevelForBinding(
            nextBinding,
            nextModelProvider?.supportedThinkingLevels,
          );
      await store.appState?.configureActiveSession({
        mode: toValue(mode),
        providerId: candidate.id,
        modelId: nextModelId,
        thinkingLevel: nextThinkingLevel,
      });
      query.value = "";
      view.value = "root";
      modelHighlight.value = -1;
      thinkingHighlight.value = -1;
    } catch (error) {
      store.appState?.showToast(
        error instanceof Error ? error.message : String(error),
        { variant: "error" },
      );
    }
  };

  /**
   * Commit a reasoning level without leaving the menu surface. Latest-wins:
   * a drag that crosses several stops only persists the last pending level
   * after the in-flight write settles. Returns false when the configuration
   * is rejected or invalidated by a session/model change.
   */
  const commitThinkingLevel = (level: SessionThinkingLevel): Promise<boolean> =>
    thinkingQueue.commit(level);

  const selectThinkingLevel = async (level: SessionThinkingLevel) => {
    if (!(await commitThinkingLevel(level))) return;
    view.value = "root";
    modelHighlight.value = -1;
    thinkingHighlight.value = -1;
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      open.value = false;
      return;
    }
    if (event.key === "ArrowLeft" && view.value !== "root") {
      event.preventDefault();
      showView("root");
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      if (
        event.key === "Enter" &&
        view.value === "model" &&
        event.target instanceof HTMLInputElement
      ) {
        const entry = flatModels.value[modelHighlight.value];
        if (entry) {
          event.preventDefault();
          void selectModel(entry.provider, entry.model.modelId);
        }
      }
      if (event.key === "Enter" && view.value === "thinking") {
        const level =
          thinkingMenuLevels.value[thinkingHighlight.value] ??
          thinkingMenuLevels.value[0];
        if (level) {
          event.preventDefault();
          void selectThinkingLevel(level);
        }
      }
      return;
    }
    if (view.value === "root") return;
    event.preventDefault();
    if (view.value === "model") {
      if (!flatModels.value.length) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const length = flatModels.value.length;
      const current = modelHighlight.value;
      const base = current < 0 ? (delta > 0 ? -1 : length) : current;
      modelHighlight.value = (base + delta + length) % length;
      return;
    }
    if (!thinkingMenuLevels.value.length) return;
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const length = thinkingMenuLevels.value.length;
    const current = thinkingHighlight.value;
    const base = current < 0 ? (delta > 0 ? -1 : length) : current;
    thinkingHighlight.value = (base + delta + length) % length;
  };

  return {
    open,
    setOpen: (value: boolean | ((current: boolean) => boolean)) => {
      open.value = typeof value === "function" ? value(open.value) : value;
    },
    view,
    query,
    setQuery: (value: string) => {
      query.value = value;
    },
    modelHighlight,
    setModelHighlight: (value: number) => {
      modelHighlight.value = value;
    },
    thinkingHighlight,
    setThinkingHighlight: (value: number) => {
      thinkingHighlight.value = value;
    },
    rootMenuRef,
    modelSearchRef,
    modelListRef,
    thinkingListRef,
    modelGroups: filteredModelGroups,
    flatModels,
    thinkingMenuLevels,
    showView,
    selectModel,
    commitThinkingLevel,
    selectThinkingLevel,
    onMenuKeyDown,
    controlsBlocked: controlsBlockedProjection,
  };
}
