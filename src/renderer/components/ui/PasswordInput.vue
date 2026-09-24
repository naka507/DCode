<script setup lang="ts">
/**
 * Password field with a reveal toggle.
 *
 * The `ui` surface. Module's `PasswordInput`: the same
 * `password-input` / `password-input-toggle` markup, with the reveal state held
 * locally. The label pair is passed in already translated, so this component
 * stays free of i18n.
 */
import { ref } from "vue";
import Input from "./Input.vue";
import { IconEye, IconEyeOff } from "../../lib/icons";

/*
  Every attribute the caller passes belongs on the inner `<input>`, exactly as
  the props spread onto `<Input>` and onto nothing else. Without this
  the default fallthrough would also bind `onInput` to the wrapper `<span>`, so
  a bubbling input event would run the caller's handler twice.
*/
defineOptions({ inheritAttrs: false });

defineProps<{
  /** Localized `aria-label` for the reveal control; the caller passes `t(...)`. */
  showLabel: string;
  hideLabel: string;
  disabled?: boolean;
}>();

const revealed = ref(false);
</script>

<template>
  <span class="password-input">
    <Input
      v-bind="$attrs"
      :type="revealed ? 'text' : 'password'"
      :disabled="disabled"
    />
    <button
      type="button"
      class="password-input-toggle"
      :aria-label="revealed ? hideLabel : showLabel"
      :aria-pressed="revealed"
      :disabled="disabled"
      @click="revealed = !revealed"
    >
      <IconEyeOff v-if="revealed" :size="16" />
      <IconEye v-else :size="16" />
    </button>
  </span>
</template>
