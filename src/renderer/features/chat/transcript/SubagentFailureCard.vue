<script setup lang="ts">
/**
 * Why a settled delegate failed, at the foot of its detail panel (issue #161).
 *
 * The step stream ends on `Failed` / `Timed out` / `Aborted` without saying
 * why: a delegate that dies before emitting a message row has no other carrier
 * for its reason, and the badge plus a duration is all a reader gets. The
 * runtime already reports `error: { code, message }` on the delegation roster
 * entry, so it is rendered here with the same visual language as the parent
 * reply's error card instead of being reachable only by reading the raw tool
 * result.
 *
 * The `SubagentFailureCard` component. It is kept
 * module-private in the same file as `SubagentDetail`; an SFC holds one
 * template, so it lives in its own file. The split is not cosmetic: the card
 * owns its `open` state, and unmounting the component whenever the condition
 * at the call site flipped used to reset that state — a `ref` in the parent
 * would instead remember the previous delegate's disclosure.
 *
 * The decisions that are not mechanical:
 *
 *  1. **`t("a.b", "Fallback")` becomes `t("a.b")`.** Every key is present in
 *     the catalogs, so a fallback would only hide a missing one.
 *  2. **`aria-hidden="true"` is explicit** on the icon wrapper and the caret:
 *     the attributes were written bare before, which renders as `""` in a Vue
 *     template.
 *  3. **The `errors.<code>` probe is unchanged.** A code the catalog does not
 *     know makes `t()` return the key itself, which is exactly the test the
 *     original ran against i18next, so an unknown code still falls back to the
 *     outcome's own localized label.
 */
import { computed, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import { IconChevronRight, IconCircleAlert } from "../../../lib/icons";
import type {
  DelegationFailure,
  SubagentOutcome,
} from "../../../lib/subagent-topology";
import CopyButton from "./CopyButton.vue";

const props = defineProps<{
  outcome: SubagentOutcome;
  failure: DelegationFailure;
}>();

const { t } = useI18n();
const open = ref(true);
const detailsId = useId();
const headingId = useId();

// A known runtime code already has a localized sentence; otherwise the
// outcome's own label is the summary, which stays truthful and localized.
const localizedKey = computed(() => `errors.${props.failure.code}`);
const localized = computed(() => t(localizedKey.value));
const summary = computed(() =>
  props.failure.code && localized.value !== localizedKey.value
    ? localized.value
    : t(`chat.subagentStatus.${props.outcome}`),
);
// A code-only error carries no detail to disclose, so it stays a one-line
// card rather than opening onto an empty box.
const hasMessage = computed(() => props.failure.message.length > 0);

function toggleDetails(): void {
  open.value = !open.value;
}
</script>

<template>
  <section
    class="message-error subagent-failure"
    :aria-labelledby="headingId"
    data-testid="subagent-failure"
  >
    <div class="message-error-heading">
      <span class="message-error-icon" aria-hidden="true">
        <IconCircleAlert :size="16" />
      </span>
      <div class="message-error-copy">
        <strong :id="headingId">{{ summary }}</strong>
        <code v-if="props.failure.code">{{ props.failure.code }}</code>
      </div>
      <div class="message-error-actions">
        <!--
          The toggle stays outside the collapsed region, otherwise hiding the
          details would take away the control that brings them back.
        -->
        <button
          v-if="hasMessage"
          type="button"
          class="message-error-toggle"
          :aria-expanded="open"
          :aria-controls="detailsId"
          @click="toggleDetails"
        >
          <IconChevronRight :size="12" aria-hidden="true" />
          {{ open ? t("chat.hideErrorDetails") : t("chat.showErrorDetails") }}
        </button>
      </div>
    </div>
    <div
      v-if="hasMessage"
      :id="detailsId"
      class="message-error-details"
      :class="{ open }"
      :hidden="!open"
    >
      <div class="message-error-raw">
        <pre class="selectable">{{ props.failure.message }}</pre>
        <CopyButton :text="props.failure.message" :label="t('chat.copyErrorDetails')" />
      </div>
    </div>
  </section>
</template>
