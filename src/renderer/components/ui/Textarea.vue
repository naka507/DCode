<script setup lang="ts">
/**
 * Shared textarea primitive.
 *
 * The `field-textarea` class from `styles/ui-kit.css`, with the
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
  <textarea
    class="field-textarea"
    :spellcheck="spellcheck"
    :autocorrect="autocorrect"
    :autocapitalize="autocapitalize"
  />
</template>
