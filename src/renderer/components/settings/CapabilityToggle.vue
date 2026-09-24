<script setup lang="ts">
/**
 * The switch every capability row carries.
 *
 * The `CapabilityToggle` component. The `onChange` callback is the `change`
 * emit; the `on` / `is-busy` modifiers are spelled as an object `:class` so the
 * class-name contract reads them as literal names.
 */
withDefaults(
  defineProps<{
    checked: boolean;
    label: string;
    disabled?: boolean;
    busy?: boolean;
  }>(),
  { disabled: false, busy: false },
);

const emit = defineEmits<{ change: [] }>();
</script>

<template>
  <button
    type="button"
    class="settings-toggle"
    :class="{ on: checked, 'is-busy': busy }"
    role="switch"
    :aria-checked="checked"
    :aria-label="label"
    :aria-busy="busy || undefined"
    :disabled="disabled || busy"
    @click="emit('change')"
  >
    <span class="settings-toggle-thumb" />
  </button>
</template>
