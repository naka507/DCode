<script setup lang="ts">
/**
 * File-scope chips read back from `manifest.fs`.
 *
 * The `FsScopeChips` component. The per-mode sentence is built by
 * `fsScopeChips` in the sibling `presentation.ts`, so the component stays a
 * renderer of data.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { PluginFsPolicy } from "@dcode/shared";
import { fsModeRisk, fsScopeChips } from "./presentation";

const props = defineProps<{ policy: PluginFsPolicy | undefined }>();

const { t } = useI18n();

const chips = computed(() => fsScopeChips(props.policy, t));
</script>

<template>
  <span v-if="chips.length" class="plugins-perm-chips">
    <span
      v-for="chip in chips"
      :key="chip.mode"
      class="plugins-perm-chip"
      :class="{
        'risk-high': fsModeRisk(chip.mode) === 'high',
        'risk-medium': fsModeRisk(chip.mode) === 'medium',
        'risk-low': fsModeRisk(chip.mode) === 'low',
      }"
      :title="chip.text"
    >
      {{ chip.text }}
    </span>
  </span>
</template>
