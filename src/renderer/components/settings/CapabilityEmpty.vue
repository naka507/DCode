<script setup lang="ts">
/**
 * Empty state. `action` keeps it from being a dead end.
 *
 * The `CapabilityEmpty` surface. The `icon` and `action` nodes
 * are slots; with no `icon` slot, `IconFolderOpen` renders at 18px,
 * which is the slot's fallback here.
 *
 * The glyph is chipped on a wrapper, never on the SVG itself: Lucide icons set
 * inline width/height, so padding the SVG crushed the stroke into a blank chip
 * (the `73ee3beb`). The wrapper carries `aria-hidden`, which is why the
 * fallback icon inside it no longer does — a caller that passes its own icon
 * gets the same treatment.
 */
import { useI18n } from "vue-i18n";
import { IconFolderOpen } from "../../lib/icons";

defineProps<{ message: string; hint?: string }>();

const { t } = useI18n();
</script>

<template>
  <div class="agent-capability-empty" role="status">
    <span class="agent-capability-empty-icon" aria-hidden="true">
      <slot name="icon">
        <IconFolderOpen :size="18" />
      </slot>
    </span>
    <span class="agent-capability-empty-message">{{ message }}</span>
    <span v-if="hint" class="agent-capability-empty-hint">{{ hint }}</span>
    <div v-if="$slots.action" class="agent-capability-empty-action">
      <slot name="action" />
    </div>
  </div>
</template>
