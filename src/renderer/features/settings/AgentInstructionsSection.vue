<script setup lang="ts">
/**
 * Global agent instructions editor (Settings → Instructions).
 *
 * The editor holds a local
 * draft; Save is enabled only while the draft differs from the file the host
 * last returned.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AgentInstructionFile } from "@dcode/shared";
import { api } from "../../lib/api";
import Button from "../../components/ui/Button.vue";
import SettingsCard from "./primitives/SettingsCard.vue";

const { t } = useI18n();

const global = ref<AgentInstructionFile | null>(null);
const globalDraft = ref("");
const saving = ref(false);

let cancelled = false;
onMounted(() => {
  void api
    .getAgentInstructions()
    .then((result) => {
      if (cancelled) return;
      global.value = result.global;
      globalDraft.value = result.global.content;
    })
    .catch(() => undefined);
});
onUnmounted(() => {
  cancelled = true;
});

const globalDirty = computed(
  () => global.value !== null && globalDraft.value !== global.value.content,
);

async function save() {
  saving.value = true;
  try {
    const result = await api.saveAgentInstructions("global", globalDraft.value);
    global.value = result.file;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="settings-stack">
    <SettingsCard
      :title="t('settings.instructionsGlobal')"
      :description="t('settings.instructionsGlobalDesc')"
    >
      <div class="settings-form-grid">
        <div class="settings-row-copy">
          <div class="settings-instruction-path">{{ global?.path ?? "" }}</div>
        </div>
        <textarea
          v-model="globalDraft"
          class="field-textarea settings-instruction-editor"
          :aria-label="t('settings.instructionsGlobal')"
          :spellcheck="false"
          autocorrect="off"
          autocapitalize="off"
        />
      </div>
      <div class="settings-panel-actions">
        <Button
          variant="primary"
          :disabled="!globalDirty || saving"
          @click="void save()"
        >
          {{ saving ? t("settings.saving") : t("settings.instructionsSave") }}
        </Button>
      </div>
    </SettingsCard>
  </div>
</template>
