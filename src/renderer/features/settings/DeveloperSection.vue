<script setup lang="ts">
/**
 * Developer mode plus the devtools console button (Settings → Advanced).
 *
 * The toggle is the shared
 * `.settings-toggle` surface; opening the console rejects unless developer mode
 * is on, so the failure is toasted rather than rendered inline.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AppSettings } from "@dcode/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import Button from "../../components/ui/Button.vue";
import SettingsCard from "./primitives/SettingsCard.vue";
import SettingsRow from "./primitives/SettingsRow.vue";

const props = defineProps<{
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}>();

const { t } = useI18n();
const store = useAppStore();

const enabled = computed(() => props.settings.developerMode === true);

async function openConsole() {
  try {
    await api.toggleDevTools(true);
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
  }
}
</script>

<template>
  <SettingsCard :title="t('settings.developer')">
    <SettingsRow
      :title="t('settings.developerMode')"
      :description="t('settings.developerModeDesc')"
    >
      <button
        type="button"
        class="settings-toggle"
        :class="{ on: enabled }"
        role="switch"
        :aria-checked="enabled"
        :aria-label="t('settings.developerMode')"
        @click="void saveSettings({ developerMode: !enabled })"
      >
        <span class="settings-toggle-thumb" />
      </button>
    </SettingsRow>
    <SettingsRow
      :title="t('settings.devTools')"
      :description="enabled ? undefined : t('settings.devToolsDisabledHint')"
    >
      <Button
        variant="secondary"
        :disabled="!enabled"
        @click="void openConsole()"
      >
        {{ t("settings.openDevTools") }}
      </Button>
    </SettingsRow>
  </SettingsCard>
</template>
