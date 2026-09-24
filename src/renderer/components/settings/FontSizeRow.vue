<script setup lang="ts">
/**
 * Global type scale (Settings → General → Appearance). Presets plus a
 * percentage slider persist as `AppSettings.fontScale` and multiply the
 * `--text-*` ramp on `:root`. Window zoom is unchanged.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  FONT_SCALE_PRESETS,
  FONT_SCALE_STEP,
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  resolveFontScale,
  type AppSettings,
} from "@dcode/shared";

import SettingsRow from "../../features/settings/primitives/SettingsRow.vue";

const props = defineProps<{
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}>();

const { t } = useI18n();

const PRESETS = [
  { scale: FONT_SCALE_PRESETS.small, key: "settings.fontSizeSmall" },
  { scale: FONT_SCALE_PRESETS.default, key: "settings.fontSizeDefault" },
  { scale: FONT_SCALE_PRESETS.large, key: "settings.fontSizeLarge" },
  { scale: FONT_SCALE_PRESETS.xl, key: "settings.fontSizeXl" },
] as const;

const current = computed(() => resolveFontScale(props.settings));
const percent = computed(() => Math.round(current.value * 100));

function commit(next: number) {
  const scale = resolveFontScale({ fontScale: next });
  if (scale === current.value) return;
  void props.saveSettings({ fontScale: scale }).catch(() => undefined);
}
</script>

<template>
  <SettingsRow
    :title="t('settings.fontSize')"
    :description="t('settings.fontSizeDesc')"
  >
      <div class="settings-font-size">
        <div
          class="settings-segment"
          role="radiogroup"
          :aria-label="t('settings.fontSize')"
        >
          <button
            v-for="preset in PRESETS"
            :key="preset.scale"
            type="button"
            role="radio"
            class="settings-segment-item"
            :class="{ active: current === preset.scale }"
            :aria-checked="current === preset.scale"
            @click="commit(preset.scale)"
          >
            {{ t(preset.key) }}
          </button>
        </div>
        <div class="settings-font-size-slider">
          <input
            type="range"
            :min="MIN_FONT_SCALE"
            :max="MAX_FONT_SCALE"
            :step="FONT_SCALE_STEP"
            :value="current"
            :aria-label="t('settings.fontSizeScale')"
            :aria-valuetext="t('settings.fontSizePercent', { value: percent })"
            @change="commit(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="settings-font-size-percent">
            {{ t("settings.fontSizePercent", { value: percent }) }}
          </span>
        </div>
    </div>
  </SettingsRow>
</template>
