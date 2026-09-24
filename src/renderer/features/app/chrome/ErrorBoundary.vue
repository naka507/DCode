<script setup lang="ts">
/**
 * Renderer crash boundary.
 *
 * The `ErrorBoundary` component, implemented with Vue's `onErrorCaptured`:
 * a single error hook
 * covers both render-time derivation and reporting, because Vue hands the
 * captured error straight to the handler instead of splitting the two
 * concerns.
 *
 * The fallback markup uses utility classes that the project's own
 * stylesheet never defined for this surface, so they are allowlisted for this
 * file in `tests/helpers/class-contract.mjs` rather than rewritten into
 * invented names.
 */
import { onErrorCaptured, ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const error = ref<Error | null>(null);

onErrorCaptured((captured) => {
  console.error("UI crash", captured);
  error.value = captured instanceof Error ? captured : new Error(String(captured));
  // Stop propagation: the boundary has taken over the subtree it wraps, so the
  // shell above it must not also report the same failure.
  return false;
});
</script>

<template>
  <div
    v-if="error"
    class="flex h-full items-center justify-center bg-bg-primary p-8 text-text-primary"
  >
    <div class="max-w-lg rounded-lg-plus border border-border-default bg-bg-secondary p-5">
      <div class="mb-2 text-base-plus font-semibold">{{ t("app.uiCrashed") }}</div>
      <pre class="whitespace-pre-wrap text-sm-plus text-error">{{ error.message }}</pre>
    </div>
  </div>
  <slot v-else />
</template>
