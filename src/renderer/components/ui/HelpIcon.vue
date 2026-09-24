<script setup lang="ts">
/**
 * The one affordance for "there is an explanation here": the sentence itself
 * lives in the tooltip, and this icon is the only trace of it left in the
 * layout (D601). It is a real button, so a keyboard reaches the same text a
 * pointer hovers, and its accessible name is that sentence.
 *
 * `TooltipButton` is composed with `tooltip` / `ariaLabel`; dcode's
 * `TooltipButton` names those props `label` and `ariaLabel`, and its
 * `as="button"` default is already the anchor this affordance needs.
 */
import TooltipButton from "../TooltipButton.vue";
import { IconHelp } from "../../lib/icons";

defineProps<{
  /** The explanation, revealed on hover/focus and used as the name. */
  label: string;
  className?: string;
}>();
</script>

<template>
  <TooltipButton
    type="button"
    :class="['ui-help-icon', className]"
    :label="label"
    tooltip-class-name="ui-tooltip-help"
    :aria-label="label"
  >
    <IconHelp :size="13" />
  </TooltipButton>
</template>
