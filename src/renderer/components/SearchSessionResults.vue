<script setup lang="ts">
/**
 * Session and message-match rows of the global search listbox.
 *
 * The `SearchSessionResults` component. The two callback props become emits:
 * `onActivate` -> `activate`, `onSelect` -> `select`.
 *
 * Two notes on the markup:
 * - the row class is built with a template literal
 * (`` `search-item ${active === . ? "active" : ""}` ``). It is a static
 *     `class` plus an object `:class` here so the class contract reads both
 *     names as the names they are; the rendered DOM is identical.
 *   - The `optionIndex` arithmetic is load-bearing and copied verbatim: a
 *     session row owns one slot, each message match owns the next one, so the
 *     flat option order in the dialog's listbox stays in step with the ids
 *     these buttons carry.
 *
 * `SearchRow` keeps its earlier shape and stays exported for the dialog, which
 * builds the rows and dispatches on `optionIndex`.
 */
import { useI18n } from "vue-i18n";
import type { SessionSearchHit, SessionSummary } from "@dcode/shared";
import { IconChat } from "../lib/icons";
import SearchHighlight from "./SearchHighlight.vue";

export type SearchRow = {
  session: SessionSummary;
  hit?: SessionSearchHit;
  archived: boolean;
  projectLabel: string;
  optionIndex: number;
};

defineProps<{
  groups: { key: string; rows: SearchRow[] }[];
  query: string;
  active: number;
  runningSessions: Record<string, boolean>;
}>();

const emit = defineEmits<{
  activate: [index: number];
  select: [row: SearchRow, messageId?: string];
}>();

const { t } = useI18n();
</script>

<template>
  <div v-for="group in groups" :key="group.key" role="presentation">
    <div class="search-group-label" role="presentation">
      {{ t(`search.${group.key}`) }}
    </div>
    <div
      v-for="row in group.rows"
      :key="row.session.id"
      role="presentation"
    >
      <button
        :id="`global-search-option-${row.optionIndex}`"
        type="button"
        role="option"
        :aria-selected="active === row.optionIndex"
        class="search-item"
        :class="{ active: active === row.optionIndex }"
        :title="row.session.title"
        @mouseenter="emit('activate', row.optionIndex)"
        @click="emit('select', row)"
      >
        <IconChat :size="15" class="search-item-icon" />
        <span class="search-session-details">
          <span class="search-item-title">
            <SearchHighlight :text="row.session.title" :query="query" />
          </span>
          <span class="search-item-meta search-session-meta">
            <span class="search-item-project">
              <SearchHighlight :text="row.projectLabel" :query="query" />
            </span>
            <span v-if="row.hit?.metadataMatch" class="search-item-badge">
              {{ t("search.metadataMatch") }}
            </span>
            <span v-if="row.hit?.messageCount" class="search-item-badge">
              {{ t("search.messageMatches", { count: row.hit.messageCount }) }}
            </span>
            <span v-if="row.archived" class="search-item-badge">
              {{ t("search.archived") }}
            </span>
          </span>
        </span>
        <span
          v-if="runningSessions[row.session.id]"
          class="search-item-running"
          :aria-label="t('nav.sessionRunning')"
        />
      </button>
      <button
        v-for="(match, index) in row.hit?.matches"
        :key="match.messageId"
        :id="`global-search-option-${row.optionIndex + index + 1}`"
        type="button"
        role="option"
        :aria-selected="active === row.optionIndex + index + 1"
        class="search-item search-message-hit"
        :class="{ active: active === row.optionIndex + index + 1 }"
        @mouseenter="emit('activate', row.optionIndex + index + 1)"
        @click="emit('select', row, match.messageId)"
      >
        <span class="search-message-meta">
          {{ match.role === "user" ? t("search.user") : t("search.assistant") }} ·
          {{ new Date(match.createdAt).toLocaleString() }}
        </span>
        <span class="search-message-snippet">
          <SearchHighlight :text="match.snippet" :query="query" />
        </span>
      </button>
    </div>
  </div>
</template>
