<script setup lang="ts">
/**
 * How much of a thinking block is shown by default.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AppSettings } from "@dcode/shared";
import { resolveThinkingDisplayMode } from "../../lib/turn-process";
import SettingsMenuSelect from "./SettingsMenuSelect.vue";
import SettingsRow from "../../features/settings/primitives/SettingsRow.vue";

const props = defineProps<{
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}>();

const { t } = useI18n();

const current = computed(() =>
  resolveThinkingDisplayMode(props.settings.thinkingDisplayMode),
);

const options = computed(() => [
  { id: "detailed", label: t("settings.thinkingDisplayDetailed") },
  { id: "compact", label: t("settings.thinkingDisplayCompact") },
]);
</script>

<template>
  <SettingsRow
    :title="t('settings.thinkingDisplayMode')"
    :description="t('settings.thinkingDisplayModeDesc')"
  >
    <SettingsMenuSelect
      :label="t('settings.thinkingDisplayMode')"
      :value="current"
      :options="options"
      @change="(value) => void saveSettings({ thinkingDisplayMode: resolveThinkingDisplayMode(value) })"
    />
  </SettingsRow>
</template>
