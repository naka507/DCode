<script setup lang="ts">
/**
 * The runtime-phase status row: what the agent runtime is doing during a quiet
 * interval (waiting for the model, compacting, retrying, waiting on delegates)
 * with the elapsed time, plus a hover/focus popover for a retry's diagnostics.
 *
 * The `RunActivityIndicator` component.
 *
 * The decisions that are not mechanical:
 *
 *  1. **The `[activity.since]` effect is a watcher plus a mount call.** The effect
 *     reset `now` and re-installed its interval whenever `activity.since`
 *     changed; `watch(() => props.activity.since, syncClock)` with
 *     `onMounted(syncClock)` reproduces exactly that, and `onScopeDispose` takes
 *     over the effect's `clearInterval`.
 *  2. **`useId()` is Vue's own.** The retry popover's `aria-describedby` target
 *     has to match the span's `id`, and both read the same value.
 *  3. **The unknown-error-code fallback survives.** `t(\`errors.${code}\`)` echoes
 *     its own key when a code has no catalog entry, and the fallback is
 *     `chat.responseFailed` in that case; the check below is that comparison, not
 *     a `t` fallback argument.
 *  4. **`aria-hidden="true"` is explicit** on the glyph wrapper and the elapsed
 *     span, where the markup writes bare `aria-hidden`.
 *  5. `retryError.networkCode` and `retryError.providerStatus` stay raw technical
 *     tokens (issue #234): the errno names the failing transport layer and the
 *     localized summary cannot.
 */
import { computed, onMounted, onScopeDispose, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AgentActivity } from "@dcode/shared";
import { formatToolDuration } from "../../../lib/tool-display";
import { IconCircleAlert } from "../../../lib/icons";
import { runActivityLabel, type Translate } from "./activity-group";

const props = defineProps<{ activity: AgentActivity }>();

const { t } = useI18n();
const retryErrorDetailsId = useId();

const now = ref(Date.now());
let timer = 0;

function stopClock(): void {
  window.clearInterval(timer);
  timer = 0;
}

 /** The clock body: reseed `now`, then tick every second. */
function syncClock(): void {
  stopClock();
  now.value = Date.now();
  timer = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
}

onMounted(syncClock);
watch(() => props.activity.since, syncClock);
onScopeDispose(stopClock);

const elapsed = computed(() =>
  formatToolDuration(Math.max(0, Math.floor((now.value - props.activity.since) / 1000))),
);
const label = computed(() =>
  runActivityLabel(props.activity, t as Translate, now.value),
);
/** Only a `retrying` phase carries diagnostics. */
const retryError = computed(() =>
  props.activity.phase === "retrying" ? props.activity.error : undefined,
);
/**
 * The localized summary of the failure code, falling back to the generic
 * response-failed line when the code has no `errors.*` entry.
 */
const retryErrorSummary = computed(() => {
  const error = retryError.value;
  if (!error) return "";
  const key = `errors.${error.code}`;
  const localized = t(key);
  return localized === key ? t("chat.responseFailed") : localized;
});
/** The whole sentence the popover's focus target announces. */
const retryLabel = computed(() => {
  const error = retryError.value;
  if (!error) return label.value;
  return `${label.value}: ${retryErrorSummary.value}: ${error.message}`;
});
/** The errno, the HTTP status, or neither — never a bare separator. */
const retryCode = computed(() => {
  const error = retryError.value;
  if (!error) return "";
  return `${error.code}${error.networkCode ? ` · ${error.networkCode}` : ""}${
    error.providerStatus !== undefined ? ` · HTTP ${error.providerStatus}` : ""
  }`;
});
</script>

<template>
  <div
    class="working-indicator run-activity-indicator"
    :data-phase="props.activity.phase"
    data-testid="run-activity-indicator"
    role="status"
    aria-live="polite"
  >
    <span class="working-indicator-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
    <span
      v-if="retryError"
      class="run-activity-retry-reason"
      tabindex="0"
      :aria-describedby="retryErrorDetailsId"
      :aria-label="retryLabel"
    >
      <span class="working-indicator-label">{{ label }}</span>
      <span
        :id="retryErrorDetailsId"
        class="run-activity-error-popover message-error"
        role="tooltip"
      >
        <span class="message-error-heading">
          <span class="message-error-icon" aria-hidden="true">
            <IconCircleAlert :size="16" />
          </span>
          <span class="message-error-copy">
            <strong>{{ retryErrorSummary }}</strong>
            <code>{{ retryCode }}</code>
          </span>
        </span>
        <span class="run-activity-error-message selectable">
          {{ retryError.message }}
        </span>
      </span>
    </span>
    <span v-else class="working-indicator-label">{{ label }}</span>
    <span class="working-elapsed" aria-hidden="true">
      {{ elapsed }}
    </span>
  </div>
</template>
