<script setup lang="ts">
/**
 * Ghost rows that mirror the real row anatomy while the host responds.
 *
 * The `CapabilitySkeleton` surface. The three ghost rows come from
 * the `[0, 1, 2].map(...)`.
 */
defineProps<{ label: string }>();
</script>

<template>
  <div class="agent-capability-skeleton" role="status" aria-live="polite">
    <span class="sr-only">{{ label }}</span>
    <div
      v-for="row in [0, 1, 2]"
      :key="row"
      class="agent-capability-skeleton-row"
      aria-hidden="true"
    >
      <span class="agent-capability-skeleton-glyph" />
      <span class="agent-capability-skeleton-lines">
        <span class="agent-capability-skeleton-line is-title" />
        <span class="agent-capability-skeleton-line is-desc" />
      </span>
    </div>
  </div>
</template>
