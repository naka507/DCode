/**
 * Framework-free half of the shared model picker.
 *
 * Split out of the panes component, which mixed the row/binding algebra with
 * the two panes. The component itself is
 * `components/settings/ModelSelectionPanes.vue`.
 *
 * The two exports tested directly (`useModelSelection`,
 * `applyVisibleModelSelection`) keep their names and their behaviour here.
 *
 * Deliberate choices, all consequences of a Vue composable running once:
 *  - `useMemo` → `computed`. The returned `ModelSelection` exposes each memo as a
 *    getter rather than a value, so the component that receives the whole object
 *    as one prop still tracks the underlying computeds when it renders.
 *  - `discovery` and `models` are read through getters instead of being passed
 *    as values: the hook re-ran on every render, so it always saw the
 *    current props. `setModels` is a plain updater function, exactly as
 *    the state setter was.
 */
import { computed } from "vue";
import {
  bindingDefaultThinkingMenuLevels,
  bindingForCustomModel,
  bindingFromModelInfo,
  publishedThinkingLevels,
  resolveBindingDefaultThinkingLevel,
  sortThinkingLevels,
  type ModelBinding,
  type ModelInfo,
  type ThinkingLevel,
} from "@dcode/shared";
import type { ProviderModelsState } from "./useProviderModels";

/** One row of the model list: what the service returned, plus its binding. */
export type ModelRow = {
  id: string;
  displayName: string;
  contextWindow?: number;
  maxTokens?: number;
  /** Published record when the service (or models.dev) described the model. */
  info?: ModelInfo;
  binding?: ModelBinding;
};

export type ModelSelection = {
  rows: ModelRow[];
  models: ModelBinding[];
  publishedLevelsById: Map<string, ThinkingLevel[]>;
  /**
   * What the caller must save: the chosen bindings with explicit thinking
   * selections preserved, including manual overrides not listed by the catalog.
   */
  bindingsToPersist: ModelBinding[];
  setModels: (update: (current: ModelBinding[]) => ModelBinding[]) => void;
};

/** The discovery object the panes read, with the optional reload capability. */
export type ModelSelectionDiscovery = ProviderModelsState & {
  canReload?: boolean;
};

/**
 * Row merging and published-level metadata for one binding list.
 *
 * Rows are the models the credential offered, plus any configured binding the
 * current answer does not mention (a hand-typed id, or an endpoint that went
 * quiet), so nothing already saved can silently disappear.
 */
export function useModelSelection(
  discovery: () => ProviderModelsState,
  models: () => ModelBinding[],
  setModels: (update: (current: ModelBinding[]) => ModelBinding[]) => void,
): ModelSelection {
  const rows = computed<ModelRow[]>(() => {
    const byId = new Map<string, ModelRow>();
    for (const model of discovery().models) {
      byId.set(model.modelId.toLowerCase(), {
        id: model.modelId,
        displayName: model.displayName,
        contextWindow: model.contextWindow ?? model.limit?.context,
        maxTokens: model.maxTokens ?? model.limit?.output,
        info: model,
      });
    }
    for (const binding of models()) {
      const key = binding.id.toLowerCase();
      const existing = byId.get(key);
      if (existing) byId.set(key, { ...existing, binding });
      else {
        byId.set(key, {
          id: binding.id,
          displayName: binding.id,
          contextWindow: binding.contextWindow,
          maxTokens: binding.maxTokens,
          binding,
        });
      }
    }
    return [...byId.values()];
  });

  /**
   * Published thinking levels are kept separately from the editable binding.
   * They seed newly added known models and explain the catalog baseline, but a
   * user may explicitly configure any canonical level for a proxy or new model.
   */
  const publishedLevelsById = computed(() => {
    const byId = new Map<string, ThinkingLevel[]>();
    for (const row of rows.value) {
      // A row with no published record is a hand-typed id, a vendor account
      // model the catalog does not list, or an endpoint that went quiet. Those
      // stay out of the map entirely: an absent entry means "unknown", which
      // preserves the stored levels, while an empty entry would erase them.
      if (!row.info) continue;
      byId.set(row.id.toLowerCase(), publishedThinkingLevels(row.info));
    }
    return byId;
  });

  /**
   * Persist the user's explicit level set. The catalog is metadata and a
   * provider endpoint may support a level that its published record omits.
   */
  const bindingsToPersist = computed(() =>
    models().map((binding) => {
      // Canonical order, because this is the same order the panel offers the
      // default in: picking the first entry of an insertion-ordered list here
      // would save a different default than the one the user was shown.
      const thinkingLevels = sortThinkingLevels(binding.thinkingLevels);
      const enabled = thinkingLevels;
      const defaultThinkingLevel = resolveBindingDefaultThinkingLevel(
        binding.defaultThinkingLevel,
        enabled,
      );
      // Always rebuild, never return `binding` itself. `models()` reads a
      // Vue `ref`, so its elements are reactive proxies; handing one back
      // would put a proxy in the save payload. `toIpcPayload` at the IPC
      // boundary also covers this, but a composable that leaks live state is
      // the wrong shape regardless of who consumes it.
      return { ...binding, thinkingLevels, defaultThinkingLevel };
    }),
  );

  return {
    get rows() {
      return rows.value;
    },
    get models() {
      return models();
    },
    get publishedLevelsById() {
      return publishedLevelsById.value;
    },
    get bindingsToPersist() {
      return bindingsToPersist.value;
    },
    setModels,
  };
}

/**
 * Add or drop every currently visible row in one step.
 *
 * The search box is a view over the live list, so "all" means the rows on
 * screen: a filtered select-all does not touch hidden matches, and a filtered
 * clear does not drop models that are still chosen off-screen. Already-chosen
 * bindings keep their advanced overrides.
 */
export function applyVisibleModelSelection(
  current: ModelBinding[],
  visibleRows: ModelRow[],
  select: boolean,
): ModelBinding[] {
  const visibleIds = new Set(visibleRows.map((row) => row.id.toLowerCase()));
  if (!select) {
    return current.filter((binding) => !visibleIds.has(binding.id.toLowerCase()));
  }
  const selected = new Set(current.map((binding) => binding.id.toLowerCase()));
  const additions: ModelBinding[] = [];
  for (const row of visibleRows) {
    if (selected.has(row.id.toLowerCase())) continue;
    additions.push(
      row.info ? bindingFromModelInfo(row.info) : bindingForCustomModel(row.id),
    );
  }
  return additions.length === 0 ? current : [...current, ...additions];
}
