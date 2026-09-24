<script setup lang="ts">
/**
 * Model/reasoning picker with its keyboard and focus contract intact.
 *
 * The `ComposerModelPicker` component. The decisions that are not mechanical:
 *
 * 1. **`t` is not a prop.** The i18next `TFunction` used to be threaded down from
 *     the toolbar; every component here reads the same instance through
 *     `useI18n()`.
 * 2. **`onCloseOtherMenus` is the `close-other-menus` emit.** The callback was a
 *     prop named without the `on` prefix; the emit name is its kebab-case.
 *  3. **`AnchoredMenu`'s `trigger(ref)` render prop is its `#trigger` slot.**
 *     The slot hands the caller `setAnchor`, which is passed to `TooltipButton`
 * as `:ref` — exactly what the render prop's ref did.
 *     `onMenuKeyDown` is that component's `menu-keydown` emit, and `onClose` its
 *     `close` emit.
 * 4. **The per-row derivations move into one `computed`.** A
 *     mutable `flatIndex` counter ran inside an IIFE while rendering, and recomputed
 *     the active flag, the option title, the badges and the context label inside
 *     the `.map()`. `groups` walks the controller's groups in the same order —
 *     so the flat indices still line up with `flatModels`, which the keyboard
 *     contract indexes — and the template only reads fields. That is the same
 *     sequence with no mutation during render.
 *  5. **The controller's refs are attached with string refs.** `rootMenuRef`,
 *     `modelSearchRef`, `modelListRef` and `thinkingListRef` are destructured at
 *     the top of the setup, so `ref="modelSearchRef"` binds the composable's own
 *     ref object — the same idiom `TurnProcess.vue` uses for
 *     `useAutomaticDisclosure`'s `titleRef`.
 * 6. `composerModelBadges` / `formatTokenCount` are the imports; the
 *     badge list is derived once per model instead of per render.
 * 7. `truncate`, `flex-1` and `sr-only` are the Tailwind utilities the
 *     markup carries on the option title, the thinking-level row and the
 *     search field's screen-reader label; neither the stylesheet nor
 * the `styles/*.css` defines them (allowlisted in the class
 *     contract).
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  formatTokenCount,
  modelIdsMatch,
  type ProviderPublic,
  type SessionThinkingLevel,
} from "@dcode/shared";
import {
  IconBot,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
  IconSparkles,
} from "../../../lib/icons";
import { composerModelBadges } from "../../../lib/composer-models";
import TooltipButton from "../../../components/TooltipButton.vue";
import AnchoredMenu from "../../../components/settings/AnchoredMenu.vue";
import type { ComposerModelMenuController } from "./hooks/useComposerModelMenu";

const props = defineProps<{
  controller: ComposerModelMenuController;
  modelLabel: string;
  thinkingLabel: string;
  thinkingLevel: string;
  selectedProviderId?: string;
  selectedModelId?: string;
  controlsBlocked: boolean;
}>();

const emit = defineEmits<{ "close-other-menus": [] }>();

const { t } = useI18n();

const {
  open,
  setOpen,
  view,
  query,
  setQuery,
  modelHighlight,
  setModelHighlight,
  thinkingHighlight,
  setThinkingHighlight,
  rootMenuRef,
  modelSearchRef,
  modelListRef,
  thinkingListRef,
  modelGroups,
  flatModels,
  thinkingMenuLevels,
  showView,
  selectModel,
  commitThinkingLevel,
  selectThinkingLevel,
  onMenuKeyDown,
} = props.controller;

/**
 * Keys the native range input must own while focused. The menu root ignores
 * arrows, but stopping propagation keeps the keys unambiguous — they adjust
 * the level, never drive menu navigation — no matter where focus lands.
 */
const THINKING_SLIDER_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Enter",
]);

// Slider geometry: one stop per available level, with the fill carried as a
// CSS custom property so the accent track can follow the native input.
const thinkingSliderIndex = computed(() =>
  Math.max(thinkingMenuLevels.value.findIndex((level) => level === props.thinkingLevel), 0),
);
/*
  Local drag lead: the native input follows the pointer or arrow key
  immediately while the store confirmation lands, so a controlled value never
  snaps back mid-drag. The lead clears once the store confirms, and a new
  ladder (a model change) clears it too.
*/
const thinkingLevelsKey = computed(() => thinkingMenuLevels.value.join("|"));
const dragThinkingIndex = ref<number | null>(null);
watch([thinkingLevelsKey, () => props.thinkingLevel], () => {
  const index = dragThinkingIndex.value;
  if (index === null) return;
  if (thinkingMenuLevels.value[index] === props.thinkingLevel) dragThinkingIndex.value = null;
});
watch(thinkingLevelsKey, () => {
  dragThinkingIndex.value = null;
});
const thinkingSliderValue = computed(() => dragThinkingIndex.value ?? thinkingSliderIndex.value);
const thinkingSliderPercent = computed(() =>
  thinkingMenuLevels.value.length > 1
    ? (thinkingSliderValue.value / (thinkingMenuLevels.value.length - 1)) * 100
    : 0,
);
const thinkingSliderStyle = computed(() => ({
  "--composer-thinking-progress": `${thinkingSliderPercent.value}%`,
}));

/** One model row, with everything derived while rendering. */
type PickerModel = {
  key: string;
  index: number;
  modelId: string;
  title: string;
  active: boolean;
  badges: Array<{ name: string; label: string }>;
  context: string | null;
};

type PickerGroup = {
  provider: ProviderPublic;
  id: string;
  label: string;
  models: PickerModel[];
};

const groups = computed<PickerGroup[]>(() => {
  let flatIndex = 0;
  return modelGroups.value.map((group) => ({
    provider: group.provider,
    id: group.provider.id,
    label: group.providerDisplayName,
    models: group.models.map((model) => {
      const index = flatIndex++;
      return {
        key: `${group.provider.id}:${model.modelId}`,
        index,
        modelId: model.modelId,
        title: model.displayName || model.modelId,
        active:
          props.selectedProviderId === group.provider.id &&
          modelIdsMatch(props.selectedModelId ?? "", model.modelId),
        badges: composerModelBadges(model, group.provider).map((badge) => ({
          name: badge,
          label: t(
            badge === "reasoning"
              ? "chat.modelBadgeReasoning"
              : "chat.modelBadgeVision",
          ),
        })),
        context: model.contextWindow
          ? formatTokenCount(model.contextWindow)
          : null,
      };
    }),
  }));
});

/** The `onClick`: close the sibling menus, reset on open, then toggle. */
function togglePicker() {
  emit("close-other-menus");
  if (!open.value) {
    showView("root");
    setQuery("");
    setModelHighlight(-1);
    setThinkingHighlight(-1);
  }
  setOpen((current) => !current);
}

/**
 * The native range input's `input` event. This reads `event.target.value`
 * from a named handler rather than an inline expression so the cast to
 * `HTMLInputElement` stays in TypeScript, where the template compiler would
 * otherwise see an `as` expression in an attribute value.
 */
function onThinkingSliderInput(event: Event) {
  const index = Number((event.target as HTMLInputElement).value);
  dragThinkingIndex.value = index;
  const level = thinkingMenuLevels.value[index];
  if (level && level !== props.thinkingLevel) void commitThinkingLevel(level);
}

/** The slider owns its arrow/Home/End/Enter keys while focused. */
function onThinkingSliderKeydown(event: KeyboardEvent) {
  if (THINKING_SLIDER_KEYS.has(event.key)) event.stopPropagation();
}

/** A tick label is a pointer shortcut: it leads the slider and commits. */
function onThinkingTickClick(level: SessionThinkingLevel, index: number) {
  dragThinkingIndex.value = index;
  if (level !== props.thinkingLevel) void commitThinkingLevel(level);
}

const triggerLabel = computed(
  () =>
    `${props.modelLabel} · ${t("chat.reasoningLevel")}: ${props.thinkingLabel}`,
);

const triggerAriaLabel = computed(
  () =>
    `${t("chat.model")}: ${props.modelLabel}. ${t("chat.reasoningLevel")}: ${props.thinkingLabel}`,
);

const menuLabel = computed(
  () => `${t("chat.model")} ${t("chat.reasoningLevel")}`,
);
</script>

<template>
  <AnchoredMenu
    class="composer-model-thinking"
    :open="open"
    menu-class-name="composer-model-menu composer-model-thinking-menu"
    :label="menuLabel"
    role="menu"
    align="end"
    side="top"
    initial-focus="none"
    @close="setOpen(false)"
    @menu-keydown="onMenuKeyDown"
  >
    <template #trigger="{ setAnchor }">
      <TooltipButton
        :ref="setAnchor"
        type="button"
        class="icon-btn composer-model-thinking-chip"
        :class="{ active: open }"
        :label="triggerLabel"
        :aria-label="triggerAriaLabel"
        aria-haspopup="menu"
        :aria-expanded="open"
        :disabled="controlsBlocked"
        @click="togglePicker"
      >
        <span class="composer-model-thinking-icon" aria-hidden="true">
          <IconBot :size="14" />
        </span>
        <span class="composer-model-thinking-model">{{ modelLabel }}</span>
        <template v-if="thinkingLevel !== 'off'">
          <span class="composer-model-thinking-dot" aria-hidden="true">·</span>
          <span class="composer-model-thinking-level">{{ thinkingLabel }}</span>
        </template>
        <IconChevronDown
          :size="12"
          aria-hidden="true"
          class="composer-model-thinking-chevron"
        />
      </TooltipButton>
    </template>

    <div v-if="view === 'root'" ref="rootMenuRef" class="composer-menu-root">
      <button
        type="button"
        class="composer-menu-entry"
        role="menuitem"
        aria-haspopup="menu"
        @click="showView('model')"
      >
        <IconBot :size="14" aria-hidden="true" />
        <span class="composer-menu-entry-label">{{ t("chat.model") }}</span>
        <span class="composer-menu-entry-value" :title="modelLabel">{{
          modelLabel
        }}</span>
        <IconChevronRight :size="14" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="composer-menu-entry"
        role="menuitem"
        aria-haspopup="menu"
        @click="showView('thinking')"
      >
        <IconSparkles :size="14" aria-hidden="true" />
        <span class="composer-menu-entry-label">{{
          t("chat.reasoningLevel")
        }}</span>
        <span class="composer-menu-entry-value">{{ thinkingLabel }}</span>
        <IconChevronRight :size="14" aria-hidden="true" />
      </button>
      <!-- The slider sits directly under the Reasoning level entry
           (issue #417): one drag adjusts the level without entering the
           submenu, while the entry itself opens the classic radio list. -->
      <div v-if="thinkingMenuLevels.length > 1" class="composer-thinking-slider">
        <input
          type="range"
          class="composer-thinking-range"
          :min="0"
          :max="thinkingMenuLevels.length - 1"
          :step="1"
          :value="thinkingSliderValue"
          :aria-label="t('chat.reasoningLevel')"
          :aria-valuetext="thinkingMenuLevels[thinkingSliderValue] ?? thinkingLevel"
          :style="thinkingSliderStyle"
          @input="onThinkingSliderInput"
          @keydown="onThinkingSliderKeydown"
        />
        <div class="composer-thinking-ticks" aria-hidden="true">
          <button
            v-for="(level, index) in thinkingMenuLevels"
            :key="level"
            type="button"
            tabindex="-1"
            class="composer-thinking-tick"
            :class="{ active: thinkingSliderValue === index }"
            :title="level"
            @mousedown.prevent
            @click="onThinkingTickClick(level, index)"
          >
            {{ level }}
          </button>
        </div>
      </div>
    </div>
    <template v-else>
      <button
        type="button"
        class="composer-menu-back"
        role="menuitem"
        @click="showView('root')"
      >
        <IconChevronLeft :size="14" aria-hidden="true" />
        <span>{{
          view === "model" ? t("chat.model") : t("chat.reasoningLevel")
        }}</span>
      </button>
      <div class="composer-menu-separator" />
      <template v-if="view === 'model'">
        <label class="composer-model-search">
          <IconSearch :size="13" aria-hidden="true" />
          <span class="sr-only">{{ t("chat.searchModels") }}</span>
          <input
            ref="modelSearchRef"
            type="text"
            :value="query"
            :placeholder="t('chat.searchModels')"
            :aria-label="t('chat.searchModels')"
            spellcheck="false"
            autocorrect="off"
            autocapitalize="off"
            @input="setQuery(($event.target as HTMLInputElement).value)"
          />
        </label>
        <div ref="modelListRef" class="composer-model-list">
          <div
            v-for="group in groups"
            :key="group.id"
            class="composer-model-group"
            role="group"
            :aria-label="group.label"
          >
            <div class="composer-model-group-label">{{ group.label }}</div>
            <button
              v-for="model in group.models"
              :key="model.key"
              type="button"
              :data-model-index="model.index"
              :title="model.title"
              class="composer-plus-item composer-model-option"
              :class="{
                active: model.active,
                'kb-active': modelHighlight === model.index,
              }"
              role="menuitemradio"
              :aria-checked="model.active"
              @mousemove="setModelHighlight(model.index)"
              @click="void selectModel(group.provider, model.modelId)"
            >
              <span class="composer-model-option-main">
                <span class="truncate">{{ model.title }}</span>
                <span class="composer-model-option-meta">
                  <span
                    v-for="badge in model.badges"
                    :key="badge.name"
                    class="composer-model-option-badge"
                    :title="badge.label"
                    >{{ badge.label }}</span
                  >
                  <span v-if="model.context" class="composer-model-option-ctx">{{
                    model.context
                  }}</span>
                </span>
              </span>
              <IconCheck
                v-if="model.active"
                :size="14"
                class="composer-model-check"
                aria-hidden="true"
              />
            </button>
          </div>
          <div v-if="flatModels.length === 0" class="composer-model-empty">
            {{ t("chat.noModelResults") }}
          </div>
        </div>
      </template>
      <template v-else>
        <div class="composer-thinking-heading">
          {{ t("chat.reasoningSupportedBy", { model: modelLabel }) }}
        </div>
        <div ref="thinkingListRef" class="composer-thinking-list">
          <button
            v-for="(level, index) in thinkingMenuLevels"
            :key="level"
            type="button"
            :data-thinking-index="index"
            class="composer-plus-item"
            :class="{
              active: thinkingLevel === level,
              'kb-active': thinkingHighlight === index,
            }"
            role="menuitemradio"
            :aria-checked="thinkingLevel === level"
            @mousemove="setThinkingHighlight(index)"
            @click="void selectThinkingLevel(level)"
          >
            <span class="flex-1">{{ level }}</span>
            <IconCheck
              v-if="thinkingLevel === level"
              :size="14"
              class="composer-model-check"
              aria-hidden="true"
            />
          </button>
        </div>
      </template>
    </template>
  </AnchoredMenu>
</template>
