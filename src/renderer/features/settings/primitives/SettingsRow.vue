<script setup lang="ts">
/**
 * One settings decision: the title and its control on a single line.
 *
 * The `SettingsRow` component. The explanation never occupies a
 * permanent second line — it is reached from the question mark beside the
 * title, which keeps a card scannable (D601). `detail` is the exception in
 * kind, not in styling: a row that shows a live value (the pinned default
 * model) keeps it visible, because that is data the user came to read, not
 * prose explaining a switch.
 *
 * `description` is a string slot for markup; the live
 * value moved to the new `detail` slot. The slot stays a slot rather than a
 * string prop because the caller renders markup in it.
 */
import HelpIcon from "../../../components/ui/HelpIcon.vue";

defineProps<{
  title: string;
  /** Explanatory copy, revealed on demand from the help icon. */
  description?: string;
}>();
</script>

<template>
  <div class="settings-row">
    <div class="settings-row-copy">
      <div class="settings-row-title">
        {{ title }}
        <HelpIcon v-if="description" :label="description" />
      </div>
      <div v-if="$slots.detail" class="settings-row-detail">
        <slot name="detail" />
      </div>
    </div>
    <div class="settings-row-control">
      <slot />
    </div>
  </div>
</template>
