<script setup lang="ts">
/**
 * Compact leaf-name chip matching the composer file node (D320).
 *
 * The `FileRefChip`. The `...position`
 * so the transcript search's source mapping still finds the chip.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { isHtmlFilePath } from "../../../lib/chat-links";
import type { SourcePositionProps } from "../../../lib/markdown-source";
import { fileChipIcon } from "./shared";

const props = defineProps<{
  name: string;
  path: string;
  kind?: "image" | "file";
  onOpen: (path: string) => void;
  dataSourceStart?: number;
  dataSourceEnd?: number;
}>();

const { t } = useI18n();

const Icon = computed(() => fileChipIcon(props.name, props.kind));
const html = computed(() => isHtmlFilePath(props.path) || isHtmlFilePath(props.name));
// Vue camelizes every declared prop key, so indexing `props` with the kebab
// spelling is always undefined; only the camelCase name resolves (verified
// against the installed runtime).
const position = computed<SourcePositionProps>(() => ({
  "data-source-start": props.dataSourceStart,
  "data-source-end": props.dataSourceEnd,
}));
</script>

<template>
  <button
    type="button"
    class="composer-chip chat-file-chip"
    v-bind="position"
    :title="`${html ? t('chat.previewUrl') : t('chat.openFile')} — ${path}`"
    :aria-label="`${name} — ${path}`"
    @click="onOpen(path)"
  >
    <span class="composer-chip-icon" aria-hidden>
      <component :is="Icon" :size="13" />
    </span>
    <span class="composer-chip-name">{{ name }}</span>
  </button>
</template>
