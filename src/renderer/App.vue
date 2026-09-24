<script setup lang="ts">
/**
 * dcode renderer root.
 *
 * The `App` surface: the crash boundary wraps the
 * shell, so a render failure in any surface replaces the window with the
 * boundary's report instead of a blank page.
 */
import AppShell from "./features/app/AppShell.vue";
import ErrorBoundary from "./features/app/chrome/ErrorBoundary.vue";
</script>

<template>
  <ErrorBoundary>
    <AppShell />
  </ErrorBoundary>
</template>
