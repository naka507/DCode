<script setup lang="ts">
/**
 * Level divider inside the panel: which level, where it lives, how many.
 *
 * The `CapabilityGroupHeader` component. The `action` node is the `action`
 * slot; `path` is omitted for shipped sources that have no file, and an empty
 * `aria-hidden` span then keeps the row's three-column shape.
 */
import { useI18n } from "vue-i18n";

defineProps<{
  label: string;
  /** Resolved `.agents` path; omit for shipped sources that have no file. */
  path?: string;
  count: number;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="agent-capability-group" role="presentation">
    <span class="agent-capability-group-label">{{ label }}</span>
    <code v-if="path" class="agent-capability-group-path" :title="path">
      {{ path }}
    </code>
    <span v-else class="agent-capability-group-path" aria-hidden="true" />
    <span
      class="agent-capability-group-count"
      :title="t('settings.capabilityCount', { count })"
    >
      {{ count }}
    </span>
    <span v-if="$slots.action" class="agent-capability-group-action">
      <slot name="action" />
    </span>
  </div>
</template>
