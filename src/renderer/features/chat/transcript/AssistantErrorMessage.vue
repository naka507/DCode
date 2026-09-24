<script setup lang="ts">
/**
 * Assistant-turn failure card.
 *
 * The manual
 * disclosure hands its own title to the owning scroller before the state
 * changes (#324), which is why `notifyDisclosureAnchor` is called from the
 * click handler rather than from a watcher.
 */
import { computed, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import type { UiMessage } from "@dcode/shared";
import { useDisclosureAnchorNotifier } from "../../../lib/disclosure-anchor-context";
import { IconChevronRight, IconCircleAlert } from "../../../lib/icons";
import { useAppStore } from "../../../stores/app-store";
import CopyButton from "./CopyButton.vue";

const props = defineProps<{ message: UiMessage }>();

const { t } = useI18n();
const store = useAppStore();
const open = ref(true);
const detailsToggleRef = ref<HTMLButtonElement | null>(null);
const notifyDisclosureAnchor = useDisclosureAnchorNotifier();
const detailsId = useId();

const error = computed(() => props.message.error);
const localizedKey = computed(() => `errors.${error.value?.code ?? ""}`);
const localized = computed(() => t(localizedKey.value));
const summary = computed(() =>
  localized.value === localizedKey.value ? t("chat.responseFailed") : localized.value,
);
const configurationError = computed(() =>
  [
    "MODEL_NOT_CONFIGURED",
    "PROVIDER_SECRET_MISSING",
    "PROVIDER_UNAUTHORIZED",
  ].includes(error.value?.code ?? ""),
);
// The transport errno is what separates "DNS did not resolve" from "TLS was
// rejected" from "the socket died" for the user; the localized summary can
// only say "can't reach the provider" (issue #234).
const networkCode = computed(() => {
  const details = error.value?.details;
  if (!details || typeof details !== "object") return undefined;
  const value = (details as { networkCode?: unknown }).networkCode;
  return typeof value === "string" ? value : undefined;
});

function toggleDetails() {
  // The raw detail block changes the row's height, so this manual disclosure
  // holds its own reading position like the others (#324).
  notifyDisclosureAnchor?.(detailsToggleRef.value);
  open.value = !open.value;
}
</script>

<template>
  <section v-if="error" class="message-error" :aria-label="t('chat.responseError')">
    <div class="message-error-heading">
      <span class="message-error-icon" aria-hidden>
        <IconCircleAlert :size="16" />
      </span>
      <div class="message-error-copy">
        <strong>{{ summary }}</strong>
        <code>{{ error.code }}{{ networkCode ? ` · ${networkCode}` : "" }}</code>
      </div>
      <div class="message-error-actions">
        <button
          ref="detailsToggleRef"
          type="button"
          class="message-error-toggle"
          :aria-expanded="open"
          :aria-controls="detailsId"
          @click="toggleDetails"
        >
          <IconChevronRight :size="12" aria-hidden />
          {{ open ? t("chat.hideErrorDetails") : t("chat.showErrorDetails") }}
        </button>
        <button
          type="button"
          class="copy-btn primary"
          @click="void store.appState?.sendPrompt(t('chat.continueCurrentTaskPrompt'))"
        >
          {{ t("errors.action.continue") }}
        </button>
        <button
          v-if="configurationError"
          type="button"
          class="copy-btn"
          @click="
            store.appState?.setSettingsTab('agent');
            store.appState?.setPage('settings');
          "
        >
          {{ t("errors.action.openSettings") }}
        </button>
      </div>
    </div>
    <div
      :id="detailsId"
      class="message-error-details"
      :class="{ open }"
      :hidden="!open"
    >
      <dl>
        <template v-if="message.providerId">
          <dt>{{ t("chat.errorProvider") }}</dt>
          <dd>{{ message.providerId }}</dd>
        </template>
        <template v-if="message.modelId">
          <dt>{{ t("chat.errorModel") }}</dt>
          <dd>{{ message.modelId }}</dd>
        </template>
      </dl>
      <div class="message-error-raw">
        <pre class="selectable">{{ error.message }}</pre>
        <CopyButton :text="error.message" :label="t('chat.copyErrorDetails')" />
      </div>
    </div>
  </section>
</template>
