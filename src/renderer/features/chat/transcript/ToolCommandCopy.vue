<script setup lang="ts">
/**
 * Copies a run row's command from its head.
 *
 * The `ToolCommandCopy` component. The template
 * literal `tool-row-head-copy${copied ? " copied" : ""}` becomes a static class
 * plus an object `:class` binding.
 */
import { useI18n } from "vue-i18n";
import { useCopy } from "../../../lib/use-copy";
import { IconCheck, IconCopy } from "../../../lib/icons";
import TooltipButton from "../../../components/TooltipButton.vue";

const props = defineProps<{ command: string }>();

const { t } = useI18n();
const { copied, copy } = useCopy();
</script>

<template>
  <TooltipButton
    class="tool-row-head-copy"
    :class="{ copied }"
    :aria-label="`${t('chat.copy')} ${t('chat.toolBlockCommand')}`"
    :label="copied ? t('chat.copied') : t('chat.copy')"
    @click="copy(props.command)"
  >
    <IconCheck v-if="copied" :size="12" />
    <IconCopy v-else :size="12" />
  </TooltipButton>
</template>
