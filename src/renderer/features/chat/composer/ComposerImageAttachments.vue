<script setup lang="ts">
/**
 * Attachment strip above the composer shell.
 *
 * The `ComposerImageAttachments` component. The decisions that are not
 * mechanical:
 *
 *  1. **`onRemove` becomes the `remove` emit.** An `onRemove` callback prop is
 *     replaced by a listener for `@remove` with the reference
 *     id, matching the house kebab-case emit convention.
 *  2. **`onMouseDown` becomes `@mousedown.prevent`.** `preventDefault()` was called
 *     for the primary button only; the modifier does the same and
 *     a middle click still reaches the button's default behaviour.
 *  3. **`onKeyDown` becomes `@keydown` on the same element.** Both branches
 *     (`Enter`, ` `) are forwarded to `open`, so the handler is a plain method
 *     rather than an inline arrow.
 *  4. **`onError` hides the thumbnail by writing `hidden`.** `hidden` is a
 *     boolean attribute, so `:hidden="true"` is bound through a local set
 *     — a template cannot assign to `event.currentTarget` in a way the compiler
 *     accepts.
 *  5. **`aria-label` uses a literal em dash.** The label is
 *     `` `${reference.name} — ${reference.path}` ``; the same
 *     separator so the accessible name is unchanged.
 */
import { useI18n } from "vue-i18n";
import { IconClose, IconImage } from "../../../lib/icons";
import type { ComposerImagePreviewController } from "./hooks/useComposerImagePreview";
import type { ComposerFileReference } from "./model";

const props = defineProps<{
  controller: ComposerImagePreviewController;
  disabled: boolean;
}>();

const emit = defineEmits<{
  remove: [id: string];
}>();

const { t } = useI18n();

function open(reference: ComposerFileReference): void {
  props.controller.open(reference);
}

function onOpenKeyDown(event: KeyboardEvent, reference: ComposerFileReference): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  props.controller.open(reference);
}

/** A thumbnail that fails to decode leaves the icon-only tile behind. */
function onThumbnailError(event: Event): void {
  const image = event.currentTarget;
  if (image instanceof HTMLImageElement) image.hidden = true;
}
</script>

<template>
  <div v-if="props.controller.images.length" class="composer-image-attachments">
    <div
      v-for="reference in props.controller.images"
      :key="reference.id"
      class="composer-image-attachment"
    >
      <button
        type="button"
        class="composer-image-attachment-open"
        :title="reference.path"
        :aria-label="`${reference.name} — ${reference.path}`"
        @mousedown.prevent
        @click="open(reference)"
        @keydown="onOpenKeyDown($event, reference)"
      >
        <IconImage :size="24" />
        <img
          v-if="props.controller.sources?.get(reference.id)?.status === 'ready'"
          :src="props.controller.sources?.get(reference.id)?.src"
          alt=""
          draggable="false"
          @error="onThumbnailError"
        />
      </button>
      <button
        type="button"
        class="composer-image-attachment-remove"
        :disabled="props.disabled"
        :aria-label="t('chat.removeFileReference', { name: reference.name })"
        :title="t('chat.removeFileReference', { name: reference.name })"
        @click="emit('remove', reference.id)"
      >
        <IconClose :size="12" />
      </button>
    </div>
  </div>
</template>
