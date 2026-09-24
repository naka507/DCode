<script setup lang="ts">
/**
 * The one model picker both credential kinds render.
 *
 * The `ModelSelectionPanes` component. An AI
 * service and a vendor account differ in how they authenticate, not in what
 * choosing a model means: the same discovered list, the same binding shape, the
 * same per-model limits and thinking levels. While each dialog kept its own copy
 * the account editor silently lost the advanced controls, so the guarantee lives
 * here once instead of in a convention two files had to remember.
 *
 * The framework-free half (`useModelSelection`, `applyVisibleModelSelection`,
 * `ModelRow`, `ModelSelection`) is `./model-selection-panes`.
 *
 * Deliberate choices:
 *  - `useMemo` → `computed`, and `selection`'s fields are read through
 *    computeds here. Destructuring the prop's getters at setup would freeze the
 *    first snapshot: a Vue `setup` runs once, so `selection.models` is read
 *    inside `computed(() => …)` instead, which is what re-runs the derivation
 *    on every render.
 *  - `onReload` stays a callback prop. It is optional and gates the Fetch-list
 *    button's presence, which an emit cannot express; the child reads
 *    `props.onReload` directly, so `:on-reload` is the correct binding form.
 *  - The two local presentational helpers (`ModelsFetchErrorMessage`,
 *    `CapabilityToggle`) are inlined rather than defined as extra components:
 *    an SFC has one template block, and inlining keeps every class name in that
 *    template where the class contract can read it.
 *  - `ref={(el) => { if (el) el.indeterminate = … }}` becomes a function ref
 *    that assigns `indeterminate` on the element, the same idiom `AskToolCard`
 *    uses for `autoFocus`.
 *  - The delegation help icon is the plain `<Tooltip>` case rendered as
 *    a `<span>`, so it passes `as="span"` to `TooltipButton.vue`. A
 *    `<button>` there would invent a non-functional control.
 */
import { computed, ref, watch, type ComponentPublicInstance } from "vue";
import { useI18n } from "vue-i18n";
import {
  THINKING_LEVELS,
  bindingDefaultThinkingMenuLevels,
  bindingForCustomModel,
  bindingFromModelInfo,
  formatTokenCount,
  modelMatchesFilter,
  nativeWebSearchSupportedOn,
  resolveBindingDefaultThinkingLevel,
  sortThinkingLevels,
  type ModelBinding,
  type ModelInfo,
  type SessionThinkingLevel,
  type ThinkingLevel,
} from "@dcode/shared";
import {
  CONTEXT_WINDOW_PRESETS,
  MAX_OUTPUT_PRESETS,
  matchPresetIndex,
} from "../../lib/model-limit-presets";
import {
  IconClose,
  IconGripVertical,
  IconHelp,
  IconPlus,
  IconRefresh,
  IconSearch,
} from "../../lib/icons";
import Button from "../ui/Button.vue";
import Field from "../ui/Field.vue";
import Input from "../ui/Input.vue";
import HelpIcon from "../ui/HelpIcon.vue";
import TooltipButton from "../TooltipButton.vue";
import SettingsMenuSelect from "./SettingsMenuSelect.vue";
import { filterChosenModels, hidesAddedBinding } from "./model-chosen-filter";
import { describeModelsFetchError } from "./model-fetch-error";
import { useModelReorder } from "./useModelReorder";
import {
  applyVisibleModelSelection,
  type ModelRow,
  type ModelSelection,
  type ModelSelectionDiscovery,
} from "./model-selection-panes";

const props = withDefaults(
  defineProps<{
    discovery: ModelSelectionDiscovery;
    selection: ModelSelection;
    /** Heading of the discovered list: a service's models, or an account's. */
    listTitle: string;
    /** True while the caller saves, so the picker stops accepting input. */
    busy?: boolean;
    /** Probe the service's model list now, skipping the edit debounce. */
    onReload?: () => void;
    /**
     * Effective API style of the provider being configured. Gates the native
     * web search opt-in: only wires that can carry a provider-hosted search
     * tool offer the checkbox at all.
     */
    apiStyle?: string;
  }>(),
  { busy: false, onReload: undefined, apiStyle: undefined },
);

const { t } = useI18n();

/*
  Read the selection through computeds: `selection` is a plain object of getters
  over the caller's refs, so destructuring it here would capture one snapshot.
*/
const rows = computed(() => props.selection.rows);
const models = computed(() => props.selection.models);
const publishedLevelsById = computed(() => props.selection.publishedLevelsById);
const setModels = props.selection.setModels;

const modelQuery = ref("");
const chosenQuery = ref("");
const customModelId = ref("");
const customModelError = ref("");
const expandedModelId = ref<string | null>(models.value[0]?.id ?? null);

// The returned list is short and already local, so filtering is client-side:
// no host search and no debounced IPC round trip.
const visibleRows = computed(() => {
  const needle = modelQuery.value.trim().toLowerCase();
  if (!needle) return rows.value;
  return rows.value.filter(
    (row) =>
      row.id.toLowerCase().includes(needle) ||
      row.displayName.toLowerCase().includes(needle),
  );
});

const selected = computed(
  () => new Set(models.value.map((binding) => binding.id.toLowerCase())),
);
const visibleSelectedCount = computed(
  () => visibleRows.value.filter((row) => selected.value.has(row.id.toLowerCase())).length,
);
const allVisibleSelected = computed(
  () => visibleRows.value.length > 0 && visibleSelectedCount.value === visibleRows.value.length,
);
const someVisibleSelected = computed(
  () =>
    visibleSelectedCount.value > 0 &&
    visibleSelectedCount.value < visibleRows.value.length,
);

// Published records for the chosen rows, so the capability switches can show
// what models.dev says before the user overrides it.
const infoById = computed(() => {
  const byId = new Map<string, ModelInfo>();
  for (const row of rows.value) {
    if (row.info) byId.set(row.id.toLowerCase(), row.info);
  }
  return byId;
});

// An emptied list disables the field, so a filter still sitting in it could no
// longer be cleared by the user. Drop it with the last configured model.
watch(
  () => models.value.length,
  (length) => {
    if (length === 0) chosenQuery.value = "";
  },
);

// The hosted web search tool only exists on two wire APIs; on any other
// style the opt-in cannot work, so the checkbox stays present but disabled
// with an explanatory hint instead of silently doing nothing.
const nativeWebSearchWireCapable = computed(() =>
  nativeWebSearchSupportedOn(props.apiStyle),
);

/**
 * The chosen list narrows with the discovered list's rule plus the binding's
 * alias: a case-insensitive substring match over the id, the alias, and the
 * catalog display name, so a friendly name finds the id it stands for. The
 * rule lives in `model-chosen-filter`, so the pane, the add paths below, and
 * the tests execute one implementation instead of three copies of it.
 */
const visibleChosen = computed(() =>
  filterChosenModels(models.value, chosenQuery.value, rows.value),
);
/*
  Drag reordering runs on the *visible* rows, so a filtered list keeps the
  hidden bindings where they are; the algebra lives in `lib/list-reorder.ts`.
  The computed is passed as-is and `busy` as a getter, so the drag always sees
  the rows the filter is currently showing and the caller's current state. The
  controller's refs are destructured at the top of the setup, so the template
  reads them unwrapped — the same idiom `ComposerModelPicker.vue` uses.
*/
const {
  draggingId: reorderDraggingId,
  dropTarget: reorderDropTarget,
  disabled: reorderDisabled,
  onRowDragEnter,
  onRowDragOver,
  onRowDragLeave,
  onRowDrop,
  onHandleDragStart,
  onHandleDragEnd,
  onHandleKeydown,
} = useModelReorder(visibleChosen, setModels, () => props.busy);

/** A discovered row arrives enriched; a hand-typed id gets generic limits. */
function bindingForRow(row: ModelRow): ModelBinding {
  return row.info ? bindingFromModelInfo(row.info) : bindingForCustomModel(row.id);
}

/**
 * The rule for a model that is being added: a filter is kept while it still
 * shows the new row and dropped when the row would land out of view, so
 * nothing the user just added hides behind a search typed earlier.
 */
function keepAddedModelVisible(added: ModelBinding[]) {
  if (hidesAddedBinding(added, chosenQuery.value, rows.value)) chosenQuery.value = "";
}

function toggleModel(row: ModelRow) {
  const wanted = row.id.toLowerCase();
  const alreadyChosen = models.value.some(
    (binding) => binding.id.toLowerCase() === wanted,
  );
  if (!alreadyChosen) {
    expandedModelId.value = expandedModelId.value ?? row.id;
    keepAddedModelVisible([bindingForRow(row)]);
  }
  setModels((current) => {
    if (current.some((binding) => binding.id.toLowerCase() === wanted)) {
      return current.filter((binding) => binding.id.toLowerCase() !== wanted);
    }
    return [...current, bindingForRow(row)];
  });
}

function toggleVisibleModels(select: boolean) {
  if (select) {
    expandedModelId.value = expandedModelId.value ?? visibleRows.value[0]?.id ?? null;
    const added = visibleRows.value
      .filter((row) => !selected.value.has(row.id.toLowerCase()))
      .map((row) => bindingForRow(row));
    keepAddedModelVisible(added);
  }
  setModels((current) => applyVisibleModelSelection(current, visibleRows.value, select));
}

function updateBinding(id: string, update: Partial<ModelBinding>) {
  setModels((current) =>
    current.map((binding) => (binding.id === id ? { ...binding, ...update } : binding)),
  );
}

function addCustomModel() {
  const id = customModelId.value.trim();
  if (!id) {
    customModelError.value = t("settings.customModelRequired");
    return;
  }
  if (models.value.some((binding) => binding.id.toLowerCase() === id.toLowerCase())) {
    customModelError.value = t("settings.modelAlreadyAdded");
    return;
  }
  const binding = bindingForCustomModel(id);
  setModels((current) => [...current, binding]);
  expandedModelId.value = id;
  customModelId.value = "";
  customModelError.value = "";
  keepAddedModelVisible([binding]);
}

/**
 * The inline `onKeyDown` for the custom-model input. It has to be a
 * named handler rather than an inline template expression: the Vue template
 * compiler parses an attribute value as a single expression and rejects
 * `return` outside a function body, which `if (event.key !== "Enter") return;`
 * is.
 */
function onCustomModelKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addCustomModel();
}

/*
  `indeterminate` is a DOM property with no attribute, so a template binding
  cannot set it: `:indeterminate` would write a `"true"` attribute instead. The
  element is captured through a function ref and the property is written from a
  `watch`, so it also follows a later change (a filter narrowing the visible set).
*/
const selectAllRef = ref<HTMLInputElement | null>(null);

function setSelectAllRef(element: Element | ComponentPublicInstance | null) {
  selectAllRef.value = element instanceof HTMLInputElement ? element : null;
  if (selectAllRef.value) selectAllRef.value.indeterminate = someVisibleSelected.value;
}

watch(someVisibleSelected, (value) => {
  if (selectAllRef.value) selectAllRef.value.indeterminate = value;
});

const fetchFailed = computed(() => props.discovery.status === "error");
const emptyFetchError = computed(() => fetchFailed.value && rows.value.length === 0);

/** The compact one-line summary of a failed live probe, by error kind. */
function fetchErrorSummary(error?: string): string {
  const view = describeModelsFetchError(error);
  switch (view.kind) {
    case "unauthorized":
      return t("errors.PROVIDER_UNAUTHORIZED");
    case "notFound":
      return t("settings.modelsFetchNotFound");
    case "rateLimited":
      return t("errors.PROVIDER_RATE_LIMITED");
    case "timeout":
      return t("errors.TIMEOUT");
    case "network":
      return t("errors.NETWORK_ERROR");
    case "invalidResponse":
      return t("settings.modelsFetchInvalidResponse");
    case "http":
      return t("settings.modelsFetchFailedStatus", {
        status: view.summaryParams?.status ?? 0,
      });
    default:
      return t("settings.modelsFetchFailed");
  }
}

function fetchErrorDetail(error?: string): string | undefined {
  return describeModelsFetchError(error).detail;
}

/** `CapabilityToggle`'s effective answer: an explicit override, else catalog. */
function capabilityEffective(
  value: boolean | null | undefined,
  published: boolean,
): boolean {
  return typeof value === "boolean" ? value : published;
}

/**
 * Ticking the box back to what models.dev publishes stores "follow the
 * catalog" rather than an equal-valued override, so agreeing with the catalog
 * is the reset. That keeps a later catalog correction flowing through without
 * asking the user to understand the distinction.
 */
function capabilityNext(checked: boolean, published: boolean): boolean | null {
  return checked === published ? null : checked;
}

function toggleThinkingLevel(binding: ModelBinding, level: ThinkingLevel) {
  const on = binding.thinkingLevels.includes(level);
  const next: ThinkingLevel[] = on
    ? binding.thinkingLevels.filter((entry) => entry !== level)
    : [...binding.thinkingLevels, level];
  updateBinding(binding.id, {
    thinkingLevels: next,
    defaultThinkingLevel: resolveBindingDefaultThinkingLevel(
      binding.defaultThinkingLevel,
      sortThinkingLevels(next),
    ),
  });
}

/*
  A copied selection can remain active when the user clicks the checkbox next.
  The checkbox is an explicit toggle target, so an old selection must not cancel
  its native activation. Keyboard activation reports detail 0 and is not a click
  that carries a text selection, so it must keep toggling; a drag-selection
  inside the row is a copy gesture, not a toggle.
*/
function onRowLabelClick(event: MouseEvent) {
  if (event.detail === 0) return;
  if (event.target instanceof HTMLInputElement) return;
  const selection = window.getSelection();
  const row = event.currentTarget as HTMLElement | null;
  if (
    row &&
    selection &&
    !selection.isCollapsed &&
    row.contains(selection.anchorNode) &&
    row.contains(selection.focusNode)
  ) {
    event.preventDefault();
  }
}

</script>

<template>
  <div class="provider-setup-panes">
    <div class="provider-models">
      <div class="provider-models-head">
        <div class="provider-models-heading">
          <input
            v-if="visibleRows.length > 0"
            :ref="setSelectAllRef"
            class="provider-models-check provider-models-select-all"
            :checked="allVisibleSelected"
            :disabled="busy"
            :aria-label="
              allVisibleSelected
                ? t('settings.deselectAllVisibleModels')
                : t('settings.selectAllVisibleModels')
            "
            :title="
              allVisibleSelected
                ? t('settings.deselectAllVisibleModels')
                : t('settings.selectAllVisibleModels')
            "
            @change="toggleVisibleModels(($event.target as HTMLInputElement).checked)"
          />
          <h4 class="provider-models-title">
            {{ listTitle }}
            <!-- Where this batch came from is the heading's answer now, so the
                 list keeps its height whether the source is the catalog or
                 the fallback. -->
            <HelpIcon
              v-if="discovery.source === 'catalog'"
              :label="t('settings.modelsFromCatalogNote')"
            />
            <HelpIcon
              v-else-if="discovery.source === 'fallback'"
              :label="t('settings.modelsFallbackNote')"
            />
          </h4>
          <button
            v-if="onReload"
            type="button"
            class="provider-models-reload"
            :class="{ 'is-loading': discovery.status === 'loading' }"
            :disabled="busy || !discovery.canReload"
            @click="onReload"
          >
            <IconRefresh :size="13" aria-hidden="true" />
            {{
              discovery.status === "loading"
                ? t("settings.modelsLoading")
                : t("settings.fetchModelList")
            }}
          </button>
        </div>
        <div class="provider-models-search-wrap">
          <IconSearch :size="13" aria-hidden="true" />
          <input
            class="provider-models-search"
            :value="modelQuery"
            :placeholder="t('settings.searchModelId')"
            :aria-label="t('settings.searchModelId')"
            spellcheck="false"
            autocorrect="off"
            autocapitalize="off"
            autocomplete="off"
            @input="modelQuery = ($event.target as HTMLInputElement).value"
          />
        </div>
      </div>

      <div v-if="fetchFailed && !emptyFetchError" class="provider-models-note is-error" role="alert">
        <span class="provider-models-error-summary">{{ fetchErrorSummary(discovery.error) }}</span>
        <span v-if="fetchErrorDetail(discovery.error)" class="provider-models-error-detail">
          {{ fetchErrorDetail(discovery.error) }}
        </span>
      </div>

      <div v-if="discovery.status === 'idle'" class="provider-models-placeholder">
        {{ t("settings.modelsEmptyHint") }}
      </div>
      <div
        v-else-if="emptyFetchError"
        class="provider-models-placeholder is-error"
        role="alert"
      >
        <span class="provider-models-error-summary">{{ fetchErrorSummary(discovery.error) }}</span>
        <span v-if="fetchErrorDetail(discovery.error)" class="provider-models-error-detail">
          {{ fetchErrorDetail(discovery.error) }}
        </span>
        <span class="provider-models-error-hint">{{ t("settings.modelsFetchHint") }}</span>
      </div>
      <div v-else-if="rows.length === 0" class="provider-models-placeholder">
        {{
          discovery.status === "loading"
            ? t("settings.modelsLoading")
            : t("settings.modelsNoneFromService")
        }}
      </div>
      <div v-else-if="visibleRows.length === 0" class="provider-models-placeholder">
        {{ t("settings.noModelMatches") }}
      </div>
      <ul v-else class="provider-models-list">
        <li v-for="row in visibleRows" :key="row.id" class="provider-models-row">
          <label class="provider-models-row-label" @click="onRowLabelClick">
            <input
              type="checkbox"
              class="provider-models-check"
              :checked="selected.has(row.id.toLowerCase())"
              :disabled="busy"
              spellcheck="false"
              autocorrect="off"
              autocapitalize="off"
              @change="toggleModel(row)"
            />
            <span class="provider-models-row-copy selectable">
              <span class="provider-models-row-id font-mono">{{ row.id }}</span>
              <span
                v-if="row.displayName && row.displayName !== row.id"
                class="provider-models-row-name"
              >
                {{ row.displayName }}
              </span>
            </span>
            <span class="provider-models-row-limits">
              {{ formatTokenCount(row.contextWindow) }} ·
              {{ formatTokenCount(row.maxTokens) }}
            </span>
          </label>
        </li>
      </ul>
    </div>

    <div class="provider-chosen">
      <div class="provider-chosen-head">
        <h4 class="provider-chosen-title">{{ t("settings.modelConfigurations") }}</h4>
        <span class="provider-chosen-count">{{ models.length }}</span>
        <div class="provider-chosen-search-wrap">
          <IconSearch :size="13" aria-hidden="true" />
          <input
            class="provider-chosen-search"
            :value="chosenQuery"
            :placeholder="t('settings.searchChosenModels')"
            :aria-label="t('settings.searchChosenModels')"
            :disabled="busy || models.length === 0"
            spellcheck="false"
            autocorrect="off"
            autocapitalize="off"
            autocomplete="off"
            @input="chosenQuery = ($event.target as HTMLInputElement).value"
          />
        </div>
      </div>
      <div v-if="models.length === 0" class="provider-chosen-empty">
        {{ t("settings.noModelsChosen") }}
      </div>
      <div v-else-if="visibleChosen.length === 0" class="provider-chosen-empty">
        {{ t("settings.noChosenModelMatches") }}
      </div>
      <ul v-else class="provider-chosen-list">
        <li
          v-for="binding in visibleChosen"
          :key="binding.id"
          class="provider-chosen-row"
          :class="{ 'is-dragging': reorderDraggingId === binding.id }"
          :data-drop-placement="
            reorderDropTarget?.id === binding.id ? reorderDropTarget.placement : undefined
          "
          @dragenter="onRowDragEnter(binding.id, $event)"
          @dragover="onRowDragOver(binding.id, $event)"
          @dragleave="onRowDragLeave(binding.id, $event)"
          @drop="onRowDrop(binding.id, $event)"
        >
          <div class="provider-chosen-row-head">
            <button
              type="button"
              class="provider-chosen-reorder"
              :aria-label="t('settings.reorderModel', { name: binding.id })"
              :title="t('settings.reorderModel', { name: binding.id })"
              :disabled="reorderDisabled"
              :draggable="!reorderDisabled"
              @dragstart="onHandleDragStart(binding.id, $event)"
              @dragend="onHandleDragEnd"
              @keydown="onHandleKeydown(binding.id, $event)"
            >
              <IconGripVertical :size="14" aria-hidden="true" />
            </button>
            <span class="provider-chosen-row-id font-mono selectable">{{ binding.id }}</span>
            <span v-if="binding.alias?.trim()" class="provider-chosen-row-alias">
              {{ binding.alias.trim() }}
            </span>
            <span class="provider-chosen-row-limits">
              {{ formatTokenCount(binding.contextWindow) }} ·
              {{ formatTokenCount(binding.maxTokens) }}
            </span>
            <button
              type="button"
              class="provider-chosen-advanced-toggle"
              :aria-expanded="expandedModelId === binding.id"
              :aria-controls="`model-advanced-${binding.id}`"
              @click="expandedModelId = expandedModelId === binding.id ? null : binding.id"
            >
              {{ t("settings.advanced") }}
            </button>
            <TooltipButton
              type="button"
              class="provider-chosen-remove"
              :aria-label="t('settings.removeModel')"
              :label="t('settings.removeModel')"
              :disabled="busy"
              @click="setModels((current) => current.filter((entry) => entry.id !== binding.id))"
            >
              <IconClose :size="12" />
            </TooltipButton>
          </div>
          <!-- Dense sheet: 2xs labels, alias hint as a title tooltip. -->
          <div
            :id="`model-advanced-${binding.id}`"
            class="provider-chosen-row-body"
            :hidden="expandedModelId !== binding.id"
          >
            <label class="provider-chosen-field">
              <span class="provider-chosen-field-label">
                {{ t("settings.modelAlias") }}
                <HelpIcon :label="t('settings.modelAliasHint')" />
              </span>
              <Input
                :value="binding.alias ?? ''"
                :placeholder="t('settings.modelAliasPlaceholder')"
                @input="
                  updateBinding(binding.id, {
                    /* Host-core caps the alias at 60 Unicode scalars, so clamp by
                       code point rather than UTF-16 unit. */
                    alias: [...($event.target as HTMLInputElement).value]
                      .slice(0, 60)
                      .join(''),
                  })
                "
              />
            </label>
            <div class="provider-chosen-limits">
              <label class="provider-chosen-field">
                <span class="provider-chosen-field-label">
                  {{ t("settings.contextWindow") }}
                  <!-- A catalog window keeps following models.dev until the user
                       pins a number; the mark beside the label is the only place
                       that still says so. -->
                  <HelpIcon
                    v-if="
                      binding.contextWindowSource !== 'user' &&
                      (infoById.get(binding.id.toLowerCase())?.contextWindow ??
                        infoById.get(binding.id.toLowerCase())?.limit?.context) !== undefined
                    "
                    :label="t('settings.contextWindowCatalogHint')"
                  />
                </span>
                <!-- Preset ladder (#202): click writes the token count; the input
                     stays hand-editable off the ladder. -->
                <div
                  class="provider-limit-presets"
                  role="group"
                  :aria-label="t('settings.contextWindow')"
                >
                  <TooltipButton
                    v-for="(preset, index) in CONTEXT_WINDOW_PRESETS"
                    :key="preset.label"
                    type="button"
                    class="provider-thinking-chip"
                    :class="{
                      selected:
                        matchPresetIndex(CONTEXT_WINDOW_PRESETS, binding.contextWindow) ===
                        index,
                    }"
                    :aria-label="preset.label"
                    :label="preset.label"
                    :aria-pressed="
                      matchPresetIndex(CONTEXT_WINDOW_PRESETS, binding.contextWindow) ===
                      index
                    "
                    @click="
                      updateBinding(binding.id, {
                        contextWindow: preset.tokens,
                        contextWindowSource: 'user',
                      })
                    "
                  >
                    {{ preset.label }}
                  </TooltipButton>
                </div>
                <Input
                  type="number"
                  :min="1"
                  inputmode="numeric"
                  :value="binding.contextWindow"
                  @input="
                    updateBinding(binding.id, {
                      contextWindow: Number(($event.target as HTMLInputElement).value) || 0,
                      contextWindowSource: 'user',
                    })
                  "
                />
              </label>
              <label class="provider-chosen-field">
                <span class="provider-chosen-field-label">{{ t("settings.maxOutput") }}</span>
                <div
                  class="provider-limit-presets"
                  role="group"
                  :aria-label="t('settings.maxOutput')"
                >
                  <TooltipButton
                    v-for="(preset, index) in MAX_OUTPUT_PRESETS"
                    :key="preset.label"
                    type="button"
                    class="provider-thinking-chip"
                    :class="{
                      selected: matchPresetIndex(MAX_OUTPUT_PRESETS, binding.maxTokens) === index,
                    }"
                    :aria-label="preset.label"
                    :label="preset.label"
                    :aria-pressed="
                      matchPresetIndex(MAX_OUTPUT_PRESETS, binding.maxTokens) === index
                    "
                    @click="updateBinding(binding.id, { maxTokens: preset.tokens })"
                  >
                    {{ preset.label }}
                  </TooltipButton>
                </div>
                <Input
                  type="number"
                  :min="1"
                  inputmode="numeric"
                  :value="binding.maxTokens"
                  @input="
                    updateBinding(binding.id, {
                      maxTokens: Number(($event.target as HTMLInputElement).value) || 0,
                    })
                  "
                />
              </label>
            </div>
            <div class="provider-chosen-thinking">
              <div class="provider-chosen-thinking-head">
                <span class="provider-chosen-thinking-label">
                  {{ t("settings.supportedThinkingLevels") }}
                  <!-- Nothing published means every level here is a manual
                       override; that is what the mark explains. -->
                  <HelpIcon
                    v-if="(publishedLevelsById.get(binding.id.toLowerCase()) ?? []).length === 0"
                    :label="t('settings.thinkingManualOverrideHint')"
                  />
                </span>
                <div
                  v-if="
                    bindingDefaultThinkingMenuLevels(
                      sortThinkingLevels(binding.thinkingLevels),
                    ).length > 1
                  "
                  class="provider-chosen-thinking-default"
                >
                  <span class="provider-chosen-thinking-label">
                    {{ t("settings.defaultThinkingLevel") }}
                  </span>
                  <SettingsMenuSelect
                    class="provider-chosen-thinking-select"
                    :label="t('settings.defaultThinkingLevel')"
                    :value="
                      resolveBindingDefaultThinkingLevel(
                        binding.defaultThinkingLevel,
                        sortThinkingLevels(binding.thinkingLevels),
                      ) ?? ''
                    "
                    :options="
                      bindingDefaultThinkingMenuLevels(
                        sortThinkingLevels(binding.thinkingLevels),
                      ).map((level) => ({
                        id: level,
                        label: level,
                      }))
                    "
                    @change="
                      updateBinding(binding.id, {
                        defaultThinkingLevel: $event as SessionThinkingLevel,
                      })
                    "
                  />
                </div>
              </div>
              <div
                class="provider-chosen-thinking-chips"
                role="group"
                :aria-label="t('settings.supportedThinkingLevels')"
              >
                <TooltipButton
                  v-for="level in THINKING_LEVELS"
                  :key="level"
                  type="button"
                  class="provider-thinking-chip"
                  :class="{ selected: binding.thinkingLevels.includes(level) }"
                  :aria-label="level"
                  :label="level"
                  :aria-pressed="binding.thinkingLevels.includes(level)"
                  @click="toggleThinkingLevel(binding, level)"
                >
                  {{ level }}
                </TooltipButton>
              </div>
            </div>
            <div class="provider-chosen-capabilities">
              <span class="provider-chosen-thinking-label">
                {{ t("settings.modelCapabilities") }}
              </span>
              <div class="provider-chosen-capability-rows">
                <label class="provider-chosen-capability">
                  <input
                    type="checkbox"
                    :checked="
                      capabilityEffective(
                        binding.supportsImages,
                        infoById.get(binding.id.toLowerCase())
                          ? modelMatchesFilter(
                              infoById.get(binding.id.toLowerCase())!,
                              'vision',
                            )
                          : false,
                      )
                    "
                    @change="
                      updateBinding(binding.id, {
                        supportsImages: capabilityNext(
                          ($event.target as HTMLInputElement).checked,
                          infoById.get(binding.id.toLowerCase())
                            ? modelMatchesFilter(
                                infoById.get(binding.id.toLowerCase())!,
                                'vision',
                              )
                            : false,
                        ),
                      })
                    "
                  />
                  <span>{{ t("settings.imageInput") }}</span>
                </label>
                <label class="provider-chosen-capability">
                  <input
                    type="checkbox"
                    :checked="
                      capabilityEffective(
                        binding.supportsDocuments,
                        infoById.get(binding.id.toLowerCase())
                          ? modelMatchesFilter(infoById.get(binding.id.toLowerCase())!, 'pdf')
                          : false,
                      )
                    "
                    @change="
                      updateBinding(binding.id, {
                        supportsDocuments: capabilityNext(
                          ($event.target as HTMLInputElement).checked,
                          infoById.get(binding.id.toLowerCase())
                            ? modelMatchesFilter(infoById.get(binding.id.toLowerCase())!, 'pdf')
                            : false,
                        ),
                      })
                    "
                  />
                  <span>{{ t("settings.documentInput") }}</span>
                </label>
                <span class="provider-chosen-delegation">
                  <label class="provider-chosen-capability">
                    <input
                      type="checkbox"
                      :checked="binding.availableForSubagents ?? false"
                      @change="
                        updateBinding(binding.id, {
                          availableForSubagents:
                            ($event.target as HTMLInputElement).checked || undefined,
                        })
                      "
                    />
                    <span>{{ t("settings.availableForSubagents") }}</span>
                  </label>
                  <TooltipButton
                    as="span"
                    class="provider-chosen-delegation-help"
                    :label="t('settings.availableForSubagentsHint')"
                    :aria-label="t('settings.availableForSubagentsHint')"
                  >
                    <IconHelp :size="13" />
                  </TooltipButton>
                </span>
                <span class="provider-chosen-delegation">
                  <label class="provider-chosen-capability">
                    <input
                      type="checkbox"
                      :checked="binding.nativeWebSearch === true"
                      :disabled="!nativeWebSearchWireCapable"
                      @change="
                        updateBinding(binding.id, {
                          nativeWebSearch:
                            ($event.target as HTMLInputElement).checked || undefined,
                        })
                      "
                    />
                    <span>{{ t("settings.nativeWebSearch") }}</span>
                  </label>
                  <TooltipButton
                    as="span"
                    class="provider-chosen-delegation-help"
                    :label="
                      t(
                        nativeWebSearchWireCapable
                          ? 'settings.nativeWebSearchHint'
                          : 'settings.nativeWebSearchUnsupported',
                      )
                    "
                    :aria-label="
                      t(
                        nativeWebSearchWireCapable
                          ? 'settings.nativeWebSearchHint'
                          : 'settings.nativeWebSearchUnsupported',
                      )
                    "
                  >
                    <IconHelp :size="13" />
                  </TooltipButton>
                </span>
              </div>
            </div>
          </div>
        </li>
      </ul>

      <div class="provider-custom-model">
        <Field
          :label="t('settings.customModel')"
          :hint="customModelError || t('settings.customModelHint')"
        >
          <div class="provider-custom-model-row">
            <Input
              :value="customModelId"
              :placeholder="t('settings.customModelPlaceholder')"
              class="font-mono text-sm"
              @input="
                customModelId = ($event.target as HTMLInputElement).value;
                if (customModelError) customModelError = '';
              "
              @keydown="onCustomModelKeydown"
            />
            <Button variant="secondary" :disabled="busy" @click="addCustomModel">
              <IconPlus :size="14" />
              {{ t("settings.addCustomModel") }}
            </Button>
          </div>
        </Field>
      </div>
    </div>
  </div>
</template>
