<script setup lang="ts">
/**
 * Copy-to-clipboard button, in two shapes.
 *
 * The `CopyButton` from the transcript's shared module: `withLabel` renders the
 * inline `copy-btn` with its label, otherwise a `copy-btn icon` TooltipButton.
 * The `className` template literal is a static class plus an object
 * `:class` binding, which is the form the class-name contract reads.
 */
import { useI18n } from "vue-i18n";
import { useCopy } from "../../../lib/use-copy";
import { IconCheck, IconCopy } from "../../../lib/icons";
import TooltipButton from "../../../components/TooltipButton.vue";

const props = withDefaults(
  defineProps<{
    text: string;
    label: string;
    withLabel?: boolean;
  }>(),
  { withLabel: false },
);

const { copied, copy } = useCopy();
const { t } = useI18n();
</script>

<template>
  <button
    v-if="props.withLabel"
    class="copy-btn"
    :class="{ copied }"
    :title="copied ? t('chat.copied') : props.label"
    :aria-label="props.label"
    @click="copy(props.text)"
  >
    <IconCheck v-if="copied" :size="13" />
    <IconCopy v-else :size="13" />
    <span>{{ copied ? t('chat.copied') : props.label }}</span>
  </button>
  <TooltipButton
    v-else
    class="copy-btn icon"
    :class="{ copied }"
    :label="copied ? t('chat.copied') : props.label"
    :aria-label="props.label"
    @click="copy(props.text)"
  >
    <IconCheck v-if="copied" :size="13" />
    <IconCopy v-else :size="13" />
  </TooltipButton>
</template>
