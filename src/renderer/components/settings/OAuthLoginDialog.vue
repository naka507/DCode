<script setup lang="ts">
/**
 * Vendor-account login (ADR 0098). Every flow — PKCE with a local callback,
 * device code, a pasted code — arrives through the same event stream, so this
 * dialog renders whatever the vendor asked for rather than a per-vendor script.
 *
 * The `OAuthLoginDialog` component.
 *
 * The attempt itself belongs to the caller: the dialog only watches it. Opening
 * a login is not something a mount effect may do twice (the caller starts it
 * from the picker's click), and subscribing is safe because a session replays
 * what a new subscriber missed.
 *
 * Deliberate choices:
 *  - `createPortal(node, overlayRoot())` → `<Teleport :to="overlayRoot()">`.
 *  - `handlers.current = { onDone, onClose }` (the "read the latest closure"
 *    ref) becomes a plain read of `props` inside the subscription callback: a
 *    Vue prop is always the caller's current value, so no ref is needed.
 *  - `settled.current` is a plain `let`, since nothing renders it.
 *  - `copy()`'s `setTimeout` is tracked so unmounting cannot write state after
 *    the dialog is gone.
 *  - `onDone` / `onClose` stay callback props, as they were declared; the
 *    caller reads them at call time (`VendorAccountsSection`'s `onLoginDone`
 *    closes over the in-flight login).
 */
import { onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { OAuthPromptRequest, OAuthVendor } from "@dcode/shared";
import type { OAuthLoginSession } from "../../lib/oauth-login-session";
import { canSubmitOAuthPrompt } from "../../lib/oauth-login-prompt";
import { overlayRoot } from "../../lib/overlay-root";
import { IconCheck, IconCopy, IconExternal } from "../../lib/icons";
import Button from "../ui/Button.vue";
import Input from "../ui/Input.vue";
import TooltipButton from "../TooltipButton.vue";

type AuthUrlState = { url: string; instructions?: string; opened: boolean };

type DeviceCodeState = {
  userCode: string;
  verificationUri: string;
};

const props = defineProps<{
  vendor: OAuthVendor;
  /** The attempt this dialog reports on, already begun by the caller. */
  session: OAuthLoginSession;
  /** The login succeeded; the provider row is ready to use. */
  onDone: (accountLabel?: string) => void;
  onClose: () => void;
}>();

const { t } = useI18n();

const status = ref<string>(t("settings.vendorLoginStarting"));
const authUrl = ref<AuthUrlState | null>(null);
const deviceCode = ref<DeviceCodeState | null>(null);
const prompt = ref<OAuthPromptRequest | null>(null);
const answer = ref("");
const error = ref<string | null>(null);
const closing = ref(false);
const copied = ref<string | null>(null);

/*
  `settled` keeps a replayed outcome from closing the dialog, or toasting, a
  second time. It was held in a ref purely to keep the value across
  renders; nothing renders it here, so a plain binding is enough.
*/
let settled = false;
let copyTimer: number | undefined;
let unsubscribe: (() => void) | null = null;

unsubscribe = props.session.subscribe((event) => {
  switch (event.kind) {
    case "info":
    case "progress":
      status.value = event.message;
      break;
    case "authUrl":
      authUrl.value = {
        url: event.url,
        instructions: event.instructions,
        opened: event.opened,
      };
      break;
    case "deviceCode":
      deviceCode.value = {
        userCode: event.userCode,
        verificationUri: event.verificationUri,
      };
      break;
    case "prompt":
      answer.value = "";
      prompt.value = event.request;
      break;
    case "promptCancelled":
      // The flow answered the step itself — a callback that beat the paste box
      // — so the input has to go away on its own.
      if (prompt.value?.promptId === event.promptId) prompt.value = null;
      break;
    case "done":
      if (settled) break;
      settled = true;
      props.onDone(event.accountLabel);
      break;
    case "error":
      prompt.value = null;
      error.value = event.message;
      break;
    case "cancelled":
      if (settled) break;
      settled = true;
      props.onClose();
      break;
  }
});

onUnmounted(() => {
  unsubscribe?.();
  window.clearTimeout(copyTimer);
});

async function cancel() {
  if (closing.value) return;
  closing.value = true;
  try {
    // Aborts the local callback server or the device-code polling. The
    // `cancelled` event closes this dialog; a login main no longer knows
    // about is already over, so close directly.
    const cancelled = await props.session.cancel();
    if (!cancelled) props.onClose();
  } catch {
    props.onClose();
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (error.value) props.onClose();
  else void cancel();
}

window.addEventListener("keydown", onKeyDown);
onUnmounted(() => window.removeEventListener("keydown", onKeyDown));

function copy(value: string) {
  void navigator.clipboard.writeText(value).then(
    () => {
      copied.value = value;
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => {
        if (copied.value === value) copied.value = null;
      }, 1500);
    },
    () => undefined,
  );
}

function submitAnswer(value: string) {
  const request = prompt.value;
  if (!request) return;
  const promptId = request.promptId;
  prompt.value = null;
  void props.session.respond(promptId, value).catch((e: unknown) => {
    error.value = e instanceof Error ? e.message : String(e);
  });
}

function submitForm() {
  if (canSubmitOAuthPrompt(prompt.value, answer.value)) {
    submitAnswer(answer.value.trim());
  }
}

const canSubmitAnswer = () => canSubmitOAuthPrompt(prompt.value, answer.value);
</script>

<template>
  <Teleport :to="overlayRoot()">
    <div class="overlay provider-dialog-overlay" role="presentation">
      <div
        class="dialog oauth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="oauth-dialog-title"
      >
        <h3 id="oauth-dialog-title" class="provider-dialog-title">
          {{ vendor.loginLabel || t("settings.vendorSignInTo", { vendor: vendor.name }) }}
        </h3>

        <div v-if="error" class="oauth-error">{{ error }}</div>
        <template v-else>
          <div class="oauth-status">{{ status }}</div>

          <div v-if="authUrl" class="oauth-block">
            <div class="oauth-block-text">
              {{
                authUrl.instructions ||
                t(
                  authUrl.opened
                    ? "settings.vendorBrowserOpened"
                    : "settings.vendorBrowserFailed",
                )
              }}
            </div>
            <div class="oauth-inline-actions">
              <Button size="sm" variant="ghost" @click="copy(authUrl.url)">
                <span class="oauth-btn-inner">
                  <IconCheck v-if="copied === authUrl.url" :size="13" />
                  <IconCopy v-else :size="13" />
                  <span>{{ t("settings.vendorCopyLink") }}</span>
                </span>
              </Button>
              <a
                class="oauth-link"
                :href="authUrl.url"
                target="_blank"
                rel="noreferrer"
              >
                <IconExternal :size="13" />
                <span>{{ t("settings.vendorOpenAgain") }}</span>
              </a>
            </div>
          </div>

          <div v-if="deviceCode" class="oauth-block">
            <div class="oauth-block-text">
              {{ t("settings.vendorDeviceCodeHint") }}
            </div>
            <TooltipButton
              type="button"
              class="oauth-device-code font-mono"
              :label="t('settings.vendorCopyCode')"
              :aria-label="t('settings.vendorCopyCode')"
              @click="copy(deviceCode.userCode)"
            >
              <span>{{ deviceCode.userCode }}</span>
              <IconCheck v-if="copied === deviceCode.userCode" :size="14" />
              <IconCopy v-else :size="14" />
            </TooltipButton>
            <a
              class="oauth-link"
              :href="deviceCode.verificationUri"
              target="_blank"
              rel="noreferrer"
            >
              <IconExternal :size="13" />
              <span>{{ deviceCode.verificationUri }}</span>
            </a>
          </div>

          <div v-if="prompt" class="oauth-block">
            <div class="oauth-block-text">{{ prompt.message }}</div>
            <div v-if="prompt.type === 'select'" class="oauth-options">
              <button
                v-for="option in prompt.options ?? []"
                :key="option.id"
                type="button"
                class="oauth-option"
                @click="submitAnswer(option.id)"
              >
                <span class="oauth-option-label">{{ option.label }}</span>
                <span v-if="option.description" class="oauth-option-desc">
                  {{ option.description }}
                </span>
              </button>
            </div>
            <form v-else class="oauth-answer" @submit.prevent="submitForm">
              <Input
                :type="prompt.type === 'secret' ? 'password' : 'text'"
                :value="answer"
                :placeholder="prompt.placeholder"
                class="oauth-answer-input"
                :class="{
                  'font-mono': prompt.type === 'manual_code',
                  'text-sm-plus': prompt.type === 'manual_code',
                }"
                autocomplete="off"
                @input="answer = ($event.target as HTMLInputElement).value"
              />
              <Button type="submit" variant="primary" :disabled="!canSubmitAnswer()">
                {{ t("settings.vendorSubmit") }}
              </Button>
            </form>
          </div>
        </template>

        <div class="provider-dialog-actions">
          <Button v-if="error" variant="ghost" @click="onClose">
            {{ t("settings.close") }}
          </Button>
          <Button v-else variant="ghost" :disabled="closing" @click="void cancel()">
            {{ t("settings.cancel") }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
