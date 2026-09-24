<script setup lang="ts">
/**
 * A page action button, with or without a tooltip.
 *
 * The `CapabilityButton` surface. The `title` prop decided
 * between a `TooltipButton` and a plain `Button`; here the `TooltipButton` case
 * keeps the same class list on the anchor it renders, which is
 * what `.agent-capability-toolbar-actions > .btn`
 * and `.agent-capability-group-action > .btn` target.
 *
 * No `size="sm"` on the plain `Button`: the note says the utilities
 * live in Tailwind's `utilities` layer while the style partials are unlayered,
 * so `.btn` wins regardless; the toolbar and group-action rules supply the
 * compact geometry instead.
 */
import Button from "../ui/Button.vue";
import TooltipButton from "../TooltipButton.vue";

withDefaults(
  defineProps<{
    variant?: "primary" | "secondary";
    disabled?: boolean;
    busy?: boolean;
    title?: string;
  }>(),
  { variant: "secondary", disabled: false, busy: false, title: undefined },
);

const emit = defineEmits<{ click: [] }>();

/** The class list both branches carry, so the stylesheet reaches either one. */
function variantClass(variant: "primary" | "secondary"): string {
  return variant === "primary" ? "btn btn-primary" : "btn btn-secondary";
}
</script>

<template>
  <TooltipButton
    v-if="title"
    as="button"
    :class="variantClass(variant)"
    :label="title"
    :disabled="disabled || busy"
    :aria-busy="busy || undefined"
    @click="emit('click')"
  >
    <slot />
  </TooltipButton>
  <Button
    v-else
    :variant="variant"
    :disabled="disabled || busy"
    :aria-busy="busy || undefined"
    @click="emit('click')"
  >
    <slot />
  </Button>
</template>
