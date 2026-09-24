<script setup lang="ts">
/**
 * Mode glyph for the composer's mode chip.
 *
 * The `ModeIcon` component. The file is named after the component, and the
 * single call site imports it under whatever name it likes.
 *
 * The three-way `if` chain becomes a `computed` icon component, which is what
 * `<component :is>` needs; the branch order and the default arm (`agent` and
 * anything else fall through to the shield) are unchanged.
 */
import { computed } from "vue";
import type { Mode } from "@dcode/shared";
import { IconListChecks, IconShield, IconTarget } from "../../../lib/icons";

const props = defineProps<{ mode: Mode }>();

const icon = computed(() => {
  if (props.mode === "plan") return IconListChecks;
  if (props.mode === "goal") return IconTarget;
  return IconShield;
});
</script>

<template>
  <component :is="icon" :size="14" />
</template>
