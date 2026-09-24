<script setup lang="ts">
/**
 * Where a clicked link opens (work panel vs. the system browser).
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AppSettings, LinkOpenTarget } from "@dcode/shared";
import { LINK_OPEN_TARGET_OPTIONS } from "../primitives";
import SettingsRow from "./SettingsRow.vue";

const props = defineProps<{
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}>();

const { t } = useI18n();

const current = computed<LinkOpenTarget>(
  () => props.settings.linkOpenTarget ?? "workpanel",
);
</script>

<template>
  <SettingsRow :title="t('settings.linkOpenTarget')">
    <div
      class="settings-segment"
      role="group"
      :aria-label="t('settings.linkOpenTarget')"
    >
      <button
        v-for="[value, labelKey] in LINK_OPEN_TARGET_OPTIONS"
        :key="value"
        type="button"
        class="settings-segment-item"
        :class="{ active: current === value }"
        :aria-pressed="current === value"
        @click="void saveSettings({ linkOpenTarget: value })"
      >
        {{ t(labelKey) }}
      </button>
    </div>
  </SettingsRow>
</template>
