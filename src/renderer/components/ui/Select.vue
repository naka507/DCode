<script setup lang="ts">
/**
 * Shared select primitive.
 *
 * The `field-select` class from `styles/ui-kit.css`. Options come through the
 * default slot, which is where the caller writes its `<option>` children.
 */
</script>

<template>
  <select class="field-select">
    <slot />
  </select>
</template>
