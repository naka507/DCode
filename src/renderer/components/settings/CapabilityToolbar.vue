<script setup lang="ts">
/**
 * One toolbar for the whole page: the level filter demoted from a page section
 * to a segmented control with live counts, one search field, the project the
 * project level resolves against, and the page's primary actions.
 *
 * The `CapabilityToolbar` component. The `onFilterChange` /
 * `onSearchChange` callbacks are the `filter-change` / `search-change` emits, and the
 * `projectPicker` / `actions` nodes are slots.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { IconSearch, IconX } from "../../lib/icons";
import TooltipButton from "../TooltipButton.vue";
import type { CapabilityFilter } from "./agent-capability-layout";

const props = defineProps<{
  /** Omit to hide the filter entirely, as the global-only subagents page does. */
  filter?: CapabilityFilter;
  counts?: { all: number; global: number; project: number };
  search: string;
  searchPlaceholder: string;
}>();

const emit = defineEmits<{
  "filter-change": [filter: CapabilityFilter];
  "search-change": [value: string];
}>();

const { t } = useI18n();

/**
 * The three segments, with their labels and live counts.
 *
 * The same array sits behind a `counts ?` guard. Here the guard is a
 * `v-if` on the group, so the empty array case renders nothing either way.
 */
const segments = computed<
  readonly { id: CapabilityFilter; label: string; count: number }[]
>(() => {
  const counts = props.counts;
  if (!counts) return [];
  return [
    { id: "all", label: t("settings.capabilityFilterAll"), count: counts.all },
    {
      id: "global",
      label: t("settings.capabilityFilterGlobal"),
      count: counts.global,
    },
    {
      id: "project",
      label: t("settings.capabilityFilterProject"),
      count: counts.project,
    },
  ];
});

const showFilter = computed(
  () => Boolean(props.filter) && segments.value.length > 0,
);
</script>

<template>
  <div class="agent-capability-toolbar">
    <div
      v-if="showFilter"
      class="settings-segment agent-capability-segment"
      role="radiogroup"
      :aria-label="t('settings.capabilityFilterLabel')"
    >
      <button
        v-for="segment in segments"
        :key="segment.id"
        type="button"
        role="radio"
        :aria-checked="filter === segment.id"
        class="settings-segment-item agent-capability-segment-btn"
        :class="{ active: filter === segment.id }"
        @click="emit('filter-change', segment.id)"
      >
        {{ segment.label }}
        <span class="agent-capability-segment-count">{{ segment.count }}</span>
      </button>
    </div>
    <div class="agent-capability-search-wrap">
      <IconSearch :size="13" aria-hidden="true" />
      <input
        class="agent-capability-search"
        type="search"
        :value="search"
        :placeholder="searchPlaceholder"
        :aria-label="searchPlaceholder"
        @input="emit('search-change', ($event.target as HTMLInputElement).value)"
      />
      <TooltipButton
        v-if="search"
        as="button"
        type="button"
        class="agent-capability-search-clear"
        :label="t('settings.clearSearch')"
        :aria-label="t('settings.clearSearch')"
        @click="emit('search-change', '')"
      >
        <IconX :size="11" />
      </TooltipButton>
    </div>
    <slot name="project-picker" />
    <div v-if="$slots.actions" class="agent-capability-toolbar-actions">
      <slot name="actions" />
    </div>
  </div>
</template>
