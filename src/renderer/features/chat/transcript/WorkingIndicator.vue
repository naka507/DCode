<script setup lang="ts">
/**
 * The "working" status row: three animated dots, the running label and an
 * elapsed counter. Rendered by the transcript while no more specific runtime
 * phase is known, so the running turn stays visible through output pauses.
 *
 * The `WorkingIndicator` component.
 *
 * The decisions that are not mechanical:
 *
 * 1. **The `startedAt` ref plus its effect is a `ref` plus a watcher.** The
 *     kept `startedAtRef` so the interval callback read the latest `startedAt`
 *     without being re-created; here `startedAtRef` is a plain module-scoped
 *     `let` per instance, the interval is installed once and the `watch` rewrites
 * the ref exactly when the effect did. `useState(0)` is `ref(0)`,
 *     `useState(Date.now)`-style lazy init becomes `startedAt ?? Date.now()`.
 * 2. **The interval is torn down in `onScopeDispose`.** The
 *     `clearInterval` from the effect; this component stops it on scope dispose, which
 *     is the same point in the component's life.
 *  3. **`aria-hidden="true"` is explicit** on the glyph wrapper and the elapsed
 *     span: the markup writes them with an explicit `"true"` already, and a bare
 *     attribute in a Vue template would render as `""`.
 *  4. `t("chat.running")` carries no fallback: the key is present in every shipped
 *     catalog.
 */
import { onMounted, onScopeDispose, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { formatToolDuration } from "../../../lib/tool-display";

const props = defineProps<{ startedAt?: number }>();

const { t } = useI18n();

const elapsed = ref(0);
/** The `startedAtRef`: the interval reads this, not the prop. */
let startedAtRef = props.startedAt ?? Date.now();
let timer = 0;

function stopClock(): void {
  window.clearInterval(timer);
  timer = 0;
}

 /** The clock body: reseed the start, then tick every second. */
function syncClock(): void {
  stopClock();
  startedAtRef = props.startedAt ?? Date.now();
  elapsed.value = Math.floor((Date.now() - startedAtRef) / 1000);
  timer = window.setInterval(() => {
    elapsed.value = Math.floor((Date.now() - startedAtRef) / 1000);
  }, 1000);
}

onMounted(syncClock);
watch(() => props.startedAt, syncClock);
onScopeDispose(stopClock);
</script>

<template>
  <div
    class="working-indicator"
    data-testid="working-indicator"
    role="status"
    aria-live="polite"
  >
    <span class="working-indicator-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
    <span class="working-indicator-label">{{ t("chat.running") }}</span>
    <span v-if="elapsed > 0" class="working-elapsed" aria-hidden="true">
      {{ formatToolDuration(elapsed) }}
    </span>
  </div>
</template>
