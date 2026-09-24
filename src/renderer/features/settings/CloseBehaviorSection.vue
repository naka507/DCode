<script setup lang="ts">
/**
 * Close behavior (Windows/Linux only).
 *
 * The first close prompts once
 * (main-process dialog); the remembered choice can be changed here between tray
 * and quit, but never reverted to prompting.
 */
import { onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { CloseBehavior } from "@dcode/shared";
import { api } from "../../lib/api";
import { CLOSE_BEHAVIOR_OPTIONS } from "./developer-sections";
import SettingsCard from "./primitives/SettingsCard.vue";
import SettingsRow from "./primitives/SettingsRow.vue";

const { t } = useI18n();

const behavior = ref<CloseBehavior | null>(null);
const saveError = ref(false);

let cancelled = false;
onMounted(() => {
  void api
    .getCloseBehavior()
    .then(({ behavior: next }) => {
      if (!cancelled) behavior.value = next;
    })
    .catch(() => undefined);
});
onUnmounted(() => {
  cancelled = true;
});

async function choose(next: CloseBehavior) {
  saveError.value = false;
  try {
    await api.setCloseBehavior(next);
    behavior.value = next;
  } catch {
    saveError.value = true;
  }
}
</script>

<template>
  <SettingsCard :title="t('settings.closeBehaviorTitle')">
    <SettingsRow
      :title="t('settings.closeBehaviorTitle')"
      :description="t('settings.closeBehaviorDesc')"
    >
      <div
        class="settings-segment"
        role="radiogroup"
        :aria-label="t('settings.closeBehaviorTitle')"
      >
        <button
          v-for="[value, labelKey] in CLOSE_BEHAVIOR_OPTIONS"
          :key="value"
          type="button"
          role="radio"
          :aria-checked="behavior === value"
          :aria-label="t(labelKey)"
          class="settings-segment-item"
          :class="{ active: behavior === value }"
          @click="void choose(value)"
        >
          {{ t(labelKey) }}
        </button>
      </div>
    </SettingsRow>
    <span
      v-if="saveError"
      class="settings-command-shell-state error"
      role="status"
    >
      {{ t("settings.closeBehaviorSaveError") }}
    </span>
  </SettingsCard>
</template>
