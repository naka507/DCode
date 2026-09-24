<script setup lang="ts">
/**
 * Command-shell picker row (Settings → AI → Defaults).
 *
 * The catalog is host-owned and loads
 * once; the row keeps a local override so the select shows the user's choice
 * immediately, and reverts it when the write is refused.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type {
  AppSettings,
  CommandShellCatalog,
  CommandShellId,
} from "@dcode/shared";
import { api } from "../../../lib/api";
import {
  commandShellEffectiveStatus,
  selectedCommandShellId,
} from "../primitives";
import SettingsMenuSelect from "../../../components/settings/SettingsMenuSelect.vue";
import SettingsRow from "./SettingsRow.vue";

const props = defineProps<{
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}>();

const { t } = useI18n();

const catalog = ref<CommandShellCatalog | null>(null);
const loadError = ref(false);
const saveError = ref(false);
const selectedOverride = ref<CommandShellId | null>(null);
const saving = ref(false);

let cancelled = false;
onMounted(() => {
  void api
    .listCommandShells()
    .then((next) => {
      if (cancelled) return;
      catalog.value = next;
    })
    .catch(() => {
      if (!cancelled) loadError.value = true;
    });
});
onUnmounted(() => {
  cancelled = true;
});

const selectedId = computed(() =>
  selectedCommandShellId(catalog.value, props.settings, selectedOverride.value),
);

const effectiveStatus = computed(() =>
  commandShellEffectiveStatus(catalog.value, t),
);

const options = computed(() =>
  (catalog.value?.choices ?? []).map((choice) => ({
    id: choice.id,
    label: `${choice.label}${
      choice.available ? "" : ` - ${t("settings.commandShellUnavailable")}`
    }`,
    disabled: !choice.available,
  })),
);

async function onChange(value: string) {
  const current = catalog.value;
  if (!current || saving.value) return;
  const choice = current.choices.find((candidate) => candidate.id === value);
  if (!choice || !choice.available) return;
  saving.value = true;
  saveError.value = false;
  selectedOverride.value = choice.id;
  try {
    await props.saveSettings({ defaultCommandShell: choice.id });
    catalog.value = {
      ...current,
      configuredId: choice.id,
      effective: choice,
      fallback: false,
    };
  } catch {
    selectedOverride.value = null;
    saveError.value = true;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <SettingsRow :title="t('settings.commandShell')">
    <div
      class="settings-command-shell-control"
      :aria-busy="saving || (!catalog && !loadError)"
    >
      <span v-if="!catalog" class="settings-command-shell-state" role="status">
        {{
          loadError
            ? t("settings.commandShellLoadError")
            : t("settings.commandShellLoading")
        }}
      </span>
      <span
        v-else-if="catalog.choices.length === 0"
        class="settings-command-shell-state"
        role="status"
      >
        {{ t("settings.commandShellNoChoices") }}
      </span>
      <SettingsMenuSelect
        v-else
        class="settings-command-shell-select"
        :label="t('settings.commandShell')"
        :value="selectedId"
        :busy="saving"
        :options="options"
        @change="(value) => void onChange(value)"
      />
      <span v-if="effectiveStatus" class="settings-command-shell-status">
        {{ effectiveStatus }}
      </span>
      <span
        v-if="saveError"
        class="settings-command-shell-state error"
        role="status"
      >
        {{ t("settings.commandShellSaveError") }}
      </span>
    </div>
  </SettingsRow>
</template>
