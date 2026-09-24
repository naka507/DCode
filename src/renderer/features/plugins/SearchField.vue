<script setup lang="ts">
/**
 * Pill search field with a leading icon and a clear affordance.
 *
 * The `SearchField` component. `value` / `onChange` /
 * `placeholder` become props plus a `change` emit, and the `inputRef` that was
 * only used to refocus after a clear stays a template ref.
 *
 * The input's `value` is bound one-way and the DOM value is read in the
 * handler: a controlled `value` with an `onChange` gives
 * the same contract without the Vue `v-model` two-way sugar the other
 * inputs also avoid.
 */
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { IconSearch, IconX } from "../../lib/icons";
import TooltipButton from "../../components/TooltipButton.vue";

defineProps<{
  value: string;
  placeholder: string;
}>();

const emit = defineEmits<{ change: [next: string] }>();

const { t } = useI18n();

const inputRef = ref<HTMLInputElement | null>(null);

function onInput(event: Event): void {
  emit("change", (event.target as HTMLInputElement).value);
}

function onKeydown(event: KeyboardEvent, value: string): void {
  if (event.key === "Escape" && value) {
    event.preventDefault();
    event.stopPropagation();
    emit("change", "");
  }
}

function clear(): void {
  emit("change", "");
  inputRef.value?.focus();
}
</script>

<template>
  <div class="plugins-search-wrap">
    <IconSearch :size="14" />
    <input
      ref="inputRef"
      class="plugins-search"
      :value="value"
      :placeholder="placeholder"
      :aria-label="placeholder"
      spellcheck="false"
      autocorrect="off"
      autocapitalize="off"
      @input="onInput"
      @keydown="onKeydown($event, value)"
    />
    <TooltipButton
      v-if="value"
      type="button"
      class="plugins-search-clear"
      :aria-label="t('plugins.clearSearch')"
      :label="t('plugins.clearSearch')"
      @click="clear"
    >
      <IconX :size="12" />
    </TooltipButton>
  </div>
</template>
