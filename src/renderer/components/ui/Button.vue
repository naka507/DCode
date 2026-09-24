<script setup lang="ts">
/**
 * Shared button primitive.
 *
 * The class names are the
 * contract: `btn` plus exactly one variant class from `styles/ui-kit.css`, and
 * the size="sm" utility trio added here. Every other attribute
 * (`type`, `disabled`, `onClick`, ...) is forwarded to the element by Vue's
 * normal attribute fallthrough, and a caller-supplied `class` merges with these
 * instead of replacing them.
 */
withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "ghost";
    size?: "sm" | "md";
  }>(),
  { variant: "secondary", size: "md" },
);
</script>

<template>
  <button
    class="btn"
    :class="{
      'btn-primary': variant === 'primary',
      'btn-secondary': variant === 'secondary',
      'btn-ghost': variant === 'ghost',
      'px-2.5': size === 'sm',
      'py-1': size === 'sm',
      'text-xs': size === 'sm',
    }"
  >
    <slot />
  </button>
</template>
