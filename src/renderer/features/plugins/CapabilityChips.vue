<script setup lang="ts">
/**
 * What a plugin contributes, in a fixed order so rows stay comparable.
 *
 * The `CapabilityChips` component.
 * `t(., { defaultValue: cap })` is dropped: `plugins.capabilities` covers every value of
 * `PluginCapability`, so the fallback never fired.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { PluginCapability } from "@dcode/shared";
import { CAPABILITY_ORDER } from "./model";

const props = defineProps<{
  capabilities: readonly PluginCapability[] | undefined;
}>();

const { t } = useI18n();

const ordered = computed(() =>
  CAPABILITY_ORDER.filter((cap) => props.capabilities?.includes(cap)),
);
</script>

<template>
  <span v-if="ordered.length" class="plugins-cap-chips">
    <span v-for="cap in ordered" :key="cap" class="plugins-cap-chip">
      {{ t(`plugins.capabilities.${cap}`) }}
    </span>
  </span>
</template>
