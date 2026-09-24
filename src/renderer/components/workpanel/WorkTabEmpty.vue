<script setup lang="ts">
/**
 * Shared work-panel empty state. Matches the proportions the rest of the app
 * already uses for empty states (`.ext-empty`, `.projects-empty`): a tiled
 * icon, a title, optional supporting copy, and optional entry points below.
 *
 * The `icon` prop is a Vue component rendered through `<component :is>`.
 */
import type { Component } from "vue";

defineProps<{
  icon: Component;
  title: string;
  body?: string;
}>();
</script>

<template>
  <div class="work-tab-empty">
    <span class="work-tab-empty-icon" aria-hidden="true">
      <component :is="icon" :size="18" />
    </span>
    <p class="work-tab-empty-title">{{ title }}</p>
    <p v-if="body" class="work-tab-empty-body">{{ body }}</p>
    <slot />
  </div>
</template>
