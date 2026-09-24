<script setup lang="ts">
/**
 * Shared labelled field wrapper.
 *
 * The `ui` surface. Module's `Field`. `hint` follows the same rule as
 * a settings row's explanation: the sentence moves onto the label line behind
 * a help icon, so the field does not carry a permanent second paragraph
 * (D601).
 *
 * The layout utilities (`block`, `space-y-1.5`, `text-sm`,
 * `text-text-secondary`) come from the earlier revision markup that the moved stylesheet
 * never defined; they are allowlisted for this file in
 * `tests/helpers/class-contract.mjs` rather than rewritten, so the DOM keeps
 * matching the rendered markup.
 * `text-text-muted` stay in that allowlist: the entries are harmless and the
 * contract only guards the reverse direction.
 */
import HelpIcon from "./HelpIcon.vue";

defineProps<{ label: string; hint?: string }>();
</script>

<template>
  <label class="block space-y-1.5">
    <div class="text-sm text-text-secondary">
      {{ label }}
      <HelpIcon v-if="hint" :label="hint" />
    </div>
    <slot />
  </label>
</template>
