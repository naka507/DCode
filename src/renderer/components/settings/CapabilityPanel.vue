<script setup lang="ts">
/**
 * The one panel every row lives in.
 *
 * `loading` is first paint only; a
 * refresh that already has rows to show keeps them and dims instead, so
 * toggling a switch never replaces the list with skeletons.
 */
import { useI18n } from "vue-i18n";
import CapabilitySkeleton from "./CapabilitySkeleton.vue";

const props = withDefaults(
  defineProps<{
    loading: boolean;
    refreshing?: boolean;
    loadingLabel: string;
  }>(),
  { refreshing: false },
);

const { t } = useI18n();
</script>

<template>
  <div
    class="settings-panel agent-capability-panel"
    :class="{ 'is-refreshing': refreshing && !loading }"
  >
    <span
      v-if="refreshing && !loading"
      class="sr-only"
      role="status"
      aria-live="polite"
    >
      {{ t("settings.capabilityRefreshing") }}
    </span>
    <div
      class="agent-capability-list"
      role="list"
      :aria-busy="loading || undefined"
    >
      <CapabilitySkeleton v-if="loading" :label="props.loadingLabel" />
      <slot v-else />
    </div>
  </div>
</template>
