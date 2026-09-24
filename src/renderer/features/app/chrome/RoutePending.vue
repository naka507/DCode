<script setup lang="ts">
/**
 * Route transition placeholder.
 *
 * The `RoutePending` surface: the
 * fallback a suspended route renders while its page chunk loads.
 */
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<template>
  <div class="route-pending" role="status" :aria-label="t('app.loadingView')">
    <span class="route-pending-indicator" aria-hidden="true" />
  </div>
</template>
