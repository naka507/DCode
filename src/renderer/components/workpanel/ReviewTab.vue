<script setup lang="ts">
/**
 * Review tab — every recorded workspace change in the conversation.
 *
 * The `ReviewTab` component. The two `useMemo`s over
 * `reviewChangesFromMessages` /
 * `summarizeReviewChanges` become two `computed`s; both helpers are pure and
 * live in `lib/workspace-review.ts`, so nothing else changes. The `count`
 * placeholder of `panel.review.changes` keeps its param object.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  reviewChangesFromMessages,
  summarizeReviewChanges,
} from "../../lib/workspace-review";
import { useAppStore } from "../../stores/app-store";
import { IconDiff } from "../../lib/icons";
import ReviewChangeCard from "../ReviewChangeCard.vue";
import WorkTabEmpty from "./WorkTabEmpty.vue";

const { t } = useI18n();
const store = useAppStore();

const messages = computed(() => store.appState?.messages ?? []);
const entries = computed(() => reviewChangesFromMessages(messages.value));
const summary = computed(() => summarizeReviewChanges(entries.value));
</script>

<template>
  <WorkTabEmpty
    v-if="entries.length === 0"
    :icon="IconDiff"
    :title="t('panel.review.noChanges')"
  />
  <div v-else class="review-tab">
    <div class="review-toolbar">
      <span class="review-summary">
        {{ t("panel.review.changes", { count: summary.changeCount }) }}
      </span>
      <span class="review-toolbar-counts diff-counts">
        <span class="diff-count-add">+{{ summary.additions }}</span>
        <span class="diff-count-del">−{{ summary.deletions }}</span>
      </span>
    </div>
    <div class="review-scroll">
      <ReviewChangeCard
        v-for="entry in entries"
        :key="entry.change.snapshotId"
        :message="entry.message"
        compact
      />
    </div>
  </div>
</template>
