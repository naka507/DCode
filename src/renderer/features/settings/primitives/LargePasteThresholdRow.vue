<script setup lang="ts">
/**
 * Large-paste threshold row.
 *
 * The field commits on blur (or
 * Enter), snaps out-of-range drafts back to the current value, and reverts the
 * draft if the host refuses the write.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  MAX_LARGE_PASTE_THRESHOLD,
  MIN_LARGE_PASTE_THRESHOLD,
  normalizeLargePasteThreshold,
  type AppSettings,
} from "@dcode/shared";
import SettingsRow from "./SettingsRow.vue";

const props = defineProps<{
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}>();

const { t } = useI18n();

const currentThreshold = computed(() =>
  normalizeLargePasteThreshold(props.settings.largePasteThreshold),
);
const draft = ref(String(currentThreshold.value));
const saveError = ref(false);

watch(currentThreshold, (next) => {
  draft.value = String(next);
});

async function commit() {
  const parsed = Number(draft.value.trim());
  const next =
    Number.isInteger(parsed) &&
    parsed >= MIN_LARGE_PASTE_THRESHOLD &&
    parsed <= MAX_LARGE_PASTE_THRESHOLD
      ? parsed
      : currentThreshold.value;
  draft.value = String(next);
  if (next === currentThreshold.value) {
    saveError.value = false;
    return;
  }
  saveError.value = false;
  try {
    await props.saveSettings({ largePasteThreshold: next });
  } catch {
    draft.value = String(currentThreshold.value);
    saveError.value = true;
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.blur();
}
</script>

<template>
  <SettingsRow
    :title="t('settings.largePasteThreshold')"
    :description="t('settings.largePasteThresholdDesc')"
  >
    <div class="settings-number-control">
      <input
        v-model="draft"
        class="field-input"
        type="number"
        :min="MIN_LARGE_PASTE_THRESHOLD"
        :max="MAX_LARGE_PASTE_THRESHOLD"
        :step="1"
        inputmode="numeric"
        :aria-label="t('settings.largePasteThreshold')"
        :aria-invalid="saveError"
        spellcheck="false"
        autocorrect="off"
        autocapitalize="off"
        @blur="void commit()"
        @keydown="onKeydown"
      />
      <span
        v-if="saveError"
        class="settings-command-shell-state error"
        role="status"
      >
        {{ t("settings.largePasteThresholdSaveError") }}
      </span>
    </div>
  </SettingsRow>
</template>
