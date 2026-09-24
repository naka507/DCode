<script setup lang="ts">
/**
 * Shared text input primitive.
 *
 * The `field-input` class from `styles/ui-kit.css`, with the
 * spelling/autocorrect attributes disabled on every field.
 */
withDefaults(
  defineProps<{
    spellcheck?: boolean | "true" | "false";
    autocorrect?: string;
    autocapitalize?: string;
  }>(),
  { spellcheck: false, autocorrect: "off", autocapitalize: "off" },
);
</script>

<template>
  <input
    class="field-input"
    :spellcheck="spellcheck"
    :autocorrect="autocorrect"
    :autocapitalize="autocapitalize"
  />
</template>
