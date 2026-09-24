<script setup lang="ts">
/**
 * Which figure the composer context ring leads with (D398). Color thresholds
 * stay on remaining capacity in both modes, so "used" never repaints the
 * warning state.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AppSettings } from "@dcode/shared";
import { resolveContextUsageDisplay } from "../../../lib/context-usage";
import { CONTEXT_USAGE_DISPLAY_OPTIONS } from "../primitives";
import SettingsRow from "./SettingsRow.vue";

const props = defineProps<{
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}>();

const { t } = useI18n();

const current = computed(() =>
  resolveContextUsageDisplay(props.settings.contextUsageDisplay),
);
</script>

<template>
  <SettingsRow :title="t('settings.contextUsageDisplay')">
    <div
      class="settings-segment"
      role="radiogroup"
      :aria-label="t('settings.contextUsageDisplay')"
    >
      <button
        v-for="[value, labelKey] in CONTEXT_USAGE_DISPLAY_OPTIONS"
        :key="value"
        type="button"
        role="radio"
        class="settings-segment-item"
        :class="{ active: current === value }"
        :aria-checked="current === value"
        @click="void saveSettings({ contextUsageDisplay: value })"
      >
        {{ t(labelKey) }}
      </button>
    </div>
  </SettingsRow>
</template>
