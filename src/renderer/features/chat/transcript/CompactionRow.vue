<script setup lang="ts">
/**
 * The transcript trace of one compaction, matching Codex's `ContextCompaction`
 * turn item: a divider that says the earlier turns above it are now a summary.
 * It carries no actions — nothing about a persisted checkpoint is undoable.
 *
 * The `CompactionRow` component. The module it belongs to holds six exports;
 * an SFC holds one component, so this one lives in its own file and
 * `AssistantTurn.vue` re-exports it under the same name.
 *
 * The three-branch copy is one `computed`: the ternary was nested inside
 * the JSX text node, and a template can hold the same nested `v-if` chain but
 * not read as clearly. The strings and the branch order are kept —
 * a failed summary outranks a summarized one.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ContextCompactionMark } from "@dcode/shared";
import { formatCompactTokenCount } from "@dcode/shared";

const props = defineProps<{ mark: ContextCompactionMark }>();

const { t } = useI18n();

const detail = computed(() =>
  props.mark.fallback
    ? t("chat.compactionRowSummaryFailed")
    : props.mark.summarized
      ? t("chat.compactionRowSummary", {
          tokens: formatCompactTokenCount(props.mark.summaryTokens),
        })
      : t("chat.compactionRowNoSummary"),
);
</script>

<template>
  <div class="transcript-compaction-row" role="separator">
    <span class="transcript-compaction-label">
      {{ t("chat.compactionRow", { times: props.mark.generation }) }}
    </span>
    <span class="transcript-compaction-detail">{{ detail }}</span>
  </div>
</template>
