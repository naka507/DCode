<script setup lang="ts">
/**
 * Page shell for an agent-capability surface.
 *
 * The `AgentCapabilityPage` component. The heading is owned by
 * SettingsPage, so this contributes the toolbar and the single panel the rows
 * live in. The `toolbar` and `children` nodes are the `toolbar` and
 * default slots.
 */
defineProps<{ className?: string }>();
</script>

<template>
  <div class="agent-capability-page" :class="className">
    <slot name="toolbar" />
    <slot />
  </div>
</template>
