<script setup lang="ts">
/**
 * Plain user text: `@paths` become composer-like chips; URLs stay text links.
 *
 * The `LinkifiedText` component. An
 * `offset` counter would be threaded through `.map()` so each segment carried
 * its source range; here the offsets are computed up front in a `computed`,
 * which is the same sequence with no mutation during render.
 *
 * Bare file-like tokens in prose are *candidates* only  f3843754 /
 * a1db7e99, issue #649): a chip appears after the existing `fs/resolveRef`
 * lookup confirms a real file, so `使用llama.cpp` in a sentence stays exact
 * original text. `useVerifiedChatText` owns that verification, which is why
 * the workspace root is no longer read here.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { MessageAttachment } from "@dcode/shared";
import type { ChatTextSegment } from "../../../lib/chat-links";
import { useVerifiedChatText } from "../../../hooks/use-verified-chat-text";
import { useOpenChatFileRef, useOpenPreviewTarget } from "../../../hooks/use-preview-target";
import TooltipButton from "../../../components/TooltipButton.vue";
import FileRefChip from "./FileRefChip.vue";

const props = defineProps<{
  text: string;
  attachments?: readonly MessageAttachment[];
}>();

const { t } = useI18n();
const openTarget = useOpenPreviewTarget();
const openFileRef = useOpenChatFileRef();

type PositionedSegment = {
  segment: ChatTextSegment;
  start: number;
  end: number;
};

/*
  The composable is installed at setup time, as a hook must be; only the
  offset walk runs inside the `computed`, which is what makes the positions
  follow a later verification result without a second pass over the text.
*/
const verifiedSegments = useVerifiedChatText(
  () => props.text,
  () => props.attachments,
);

const segments = computed<PositionedSegment[]>(() => {
  let offset = 0;
  return verifiedSegments.value.map((segment) => {
    const start = offset;
    offset += segment.text.length;
    return { segment, start, end: offset };
  });
});
</script>

<template>
  <template v-for="({ segment, start, end }, index) in segments" :key="index">
    <span
      v-if="segment.kind === 'text'"
      :data-source-start="start"
      :data-source-end="end"
      >{{ segment.text }}</span
    >
    <FileRefChip
      v-else-if="segment.target.kind === 'file'"
      :name="segment.label"
      :path="segment.target.path"
      :on-open="openFileRef"
      :data-source-start="start"
      :data-source-end="end"
    />
    <TooltipButton
      v-else
      type="button"
      class="chat-text-link"
      :data-source-start="start"
      :data-source-end="end"
      :label="t('chat.previewUrl')"
      :aria-label="segment.text"
      @click="openTarget(segment.target)"
    >
      {{ segment.text }}
    </TooltipButton>
  </template>
</template>
