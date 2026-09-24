<script setup lang="ts">
/**
 * Shared badge primitive.
 *
 * `badge` plus the tone class from `styles/ui-kit.css`.
 */
withDefaults(defineProps<{ tone?: "neutral" | "success" | "error" | "warning" }>(), {
  tone: "neutral",
});
</script>

<template>
  <span
    class="badge"
    :class="{
      'badge-neutral': tone === 'neutral',
      'badge-success': tone === 'success',
      'badge-error': tone === 'error',
      'badge-warning': tone === 'warning',
    }"
  >
    <slot />
  </span>
</template>
