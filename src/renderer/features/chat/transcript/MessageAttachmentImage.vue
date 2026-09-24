<script setup lang="ts">
/**
 * User-message image attachment as a thumbnail.
 *
 * The host
 * resolves the ref into a bounded data URL; an unresolvable load falls back to
 * the file chip. Clicking opens the files viewer on the same contained ref.
 */
import { computed } from "vue";
import type { MessageAttachment } from "@dcode/shared";
import { useReferencedImageDataUrl } from "../../../lib/use-referenced-image-data-url";
import { useAppStore } from "../../../stores/app-store";
import FileRefChip from "./FileRefChip.vue";

const props = defineProps<{
  attachment: MessageAttachment;
  onOpenFile: (path: string) => void;
}>();

const store = useAppStore();
const dataUrl = useReferencedImageDataUrl(
  () => props.attachment.ref,
  () => props.attachment.mimeType,
);
const title = computed(() => `${props.attachment.name} — ${props.attachment.ref}`);
</script>

<template>
  <FileRefChip
    v-if="!dataUrl"
    :name="attachment.name"
    :path="attachment.ref"
    kind="image"
    :on-open="onOpenFile"
  />
  <button
    v-else
    type="button"
    class="message-attachment-image"
    role="listitem"
    :title="title"
    @click="
      store.appState?.openFileInWorkPanel(attachment.ref, attachment.mimeType)
    "
  >
    <img :src="dataUrl" :alt="attachment.name" />
  </button>
</template>
