<script setup lang="ts">
/**
 * The full-width rail at the bottom of an expanded disclosure body that closes
 * it again.
 *
 * A tooltip-only
 * button with no children: the accessible name and the tooltip are the same
 * string.
 */
import TooltipButton from "../../../components/TooltipButton.vue";

const props = defineProps<{
  label: string;
  onCollapse: () => void;
}>();
</script>

<template>
  <TooltipButton
    type="button"
    class="disclosure-collapse-rail"
    :aria-label="props.label"
    :label="props.label"
    @click="props.onCollapse"
  />
</template>
