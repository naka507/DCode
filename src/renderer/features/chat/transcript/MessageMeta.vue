<script setup lang="ts">
/**
 * Model chip and/or estimated-throughput chip under a finished assistant turn.
 *
 * The `MessageMeta` component. `responseOutputTokens ??
 * usage?.outputTokens ?? 0` and the "only when there is no provider usage"
 * guard are what the chip needs.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { formatCompactTokenCount, type MessageUsage } from "@dcode/shared";
import { calculateTokenRate } from "../../../lib/context-usage";

const props = defineProps<{
  modelId?: string;
  usage?: MessageUsage;
  responseDurationMs?: number;
  responseOutputTokens?: number;
}>();

const { t } = useI18n();

const throughput = computed(() =>
  calculateTokenRate(
    props.responseOutputTokens ?? props.usage?.outputTokens ?? 0,
    props.responseDurationMs,
  ),
);
const showThroughput = computed(
  () => !props.usage && throughput.value !== undefined,
);

/**
 * The throughput chip's text, or `null` when there is nothing to show.
 *
 * `showThroughput` is written as an aliased discriminant check over a
 * `const`, which TypeScript narrows at the `formatCompactTokenCount` call site.
 * `throughput` is a `computed` here, so that narrowing does not survive into the
 * template; folding the guard and the formatting into one computed keeps the
 * emitted markup and text identical while giving the formatter a `number`.
 */
const throughputText = computed(() => {
  const rate = throughput.value;
  if (props.usage || rate === undefined) return null;
  return t("chat.usageThroughputEstimated", {
    count: formatCompactTokenCount(rate),
  });
});
</script>

<template>
  <div v-if="props.modelId || showThroughput" class="message-meta">
    <span v-if="props.modelId" class="message-meta-chip model" :title="props.modelId">
      {{ props.modelId }}
    </span>
    <span v-if="throughputText" class="message-meta-chip throughput">
      {{ throughputText }}
    </span>
  </div>
</template>
