<script setup lang="ts">
/**
 * Supervision state of a plugin's resident services.
 *
 * The `ServiceChips` component. Restart counts are shown
 * because a service that keeps coming back is a different problem from one that
 * is simply running.
 *
 * The state modifier is spelled as an object of literal names rather than a
 * glued `is-${state}`: the class contract reads literal class names, and the
 * `is-` fragment of a template literal is reported as a class that no rule
 * targets. `is-stopped` is inert — this stylesheet defines no rule for it, and
 * `.plugins-service-chip` already carries
 * the stopped colour — so it is allowlisted for this file.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { PluginServiceStatus } from "@dcode/shared";

const props = defineProps<{
  statuses: readonly PluginServiceStatus[] | undefined;
}>();

const { t } = useI18n();

const rows = computed(() => props.statuses ?? []);
</script>

<template>
  <span v-if="rows.length" class="plugins-service-chips">
    <span
      v-for="status in rows"
      :key="status.serviceId"
      class="plugins-service-chip"
      :class="{
        'is-running': status.state === 'running',
        'is-starting': status.state === 'starting',
        'is-stopped': status.state === 'stopped',
        'is-failed': status.state === 'failed',
      }"
      :title="status.message || undefined"
    >
      <span class="plugins-service-dot" aria-hidden="true" />
      <span class="plugins-service-name">{{ status.label }}</span>
      <span class="plugins-service-state">
        {{ t(`plugins.serviceState.${status.state}`) }}
      </span>
      <span v-if="status.restarts > 0" class="plugins-service-restarts">
        {{ t("plugins.serviceRestarts", { count: status.restarts }) }}
      </span>
    </span>
  </span>
</template>
