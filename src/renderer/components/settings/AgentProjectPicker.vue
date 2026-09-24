<script setup lang="ts">
/**
 * The project the project level resolves against.
 *
 * The `AgentProjectPicker` component. The
 * `className="agent-capability-project-select"` prop went to `SettingsMenuSelect`; a
 * caller `class` falls through to that control's root wrapper, which is the same
 * element the name belongs on.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { IconFolder } from "../../lib/icons";
import type { AgentProjectOption } from "./agent-capability-layout";
import SettingsMenuSelect from "./SettingsMenuSelect.vue";

const props = withDefaults(
  defineProps<{
    value: string | null;
    options: readonly AgentProjectOption[];
    label: string;
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{ change: [path: string] }>();

const { t } = useI18n();

const choices = computed(() =>
  props.options.length === 0
    ? [{ id: "", label: t("settings.noProjects"), disabled: true }]
    : props.options.map((project) => ({ id: project.path, label: project.name })),
);
</script>

<template>
  <div class="agent-capability-project-picker">
    <IconFolder :size="13" aria-hidden="true" />
    <SettingsMenuSelect
      class="agent-capability-project-select"
      :label="label"
      :value="value ?? ''"
      :disabled="disabled || options.length === 0"
      :options="choices"
      @change="emit('change', $event)"
    />
  </div>
</template>
