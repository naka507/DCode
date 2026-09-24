<script setup lang="ts">
/**
 * Trusted-extension modal prompt.
 *
 * A Vue SFC is a single component, so the host and the inner dialog are folded
 * into this one default export, named after the file:
 *
 *   - the queue, the `api.onExtensionPrompt` / `api.onExtensionStatus`
 * subscriptions and the status line come from the host;
 *   - the overlay/dialog markup, the draft state and the submit path come from
 * the inner dialog.
 *
 * The inner dialog is remounted per prompt (`key={current.promptId}`), which
 * resets its `useState`; here the same reset is a `watch` on the prompt id, and
 * the mount/unmount effect (body scroll lock, focus, Escape) is keyed the same
 * way.
 *
 * The dialog renders through `createPortal(node, document.body)`, so
 * this is `<Teleport to="body">` rather than the viewport-fixed `overlayRoot()`
 * host: the portal target is the real document body, and the status line stays
 * outside the teleport, unchanged.
 *
 * Store reads: the only store read is `activeSessionId`
 * (`useAppStore((state) => state.activeSessionId)`) — the prompts themselves
 * arrive over IPC, not from the store — and that field exists on `AppState`.
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  TrustedExtensionStatusEvent,
  TrustedExtensionUiPrompt,
} from "@dcode/shared";
import { api } from "../lib/api";
import { useAppStore } from "../stores/app-store";
import Button from "./ui/Button.vue";
import TooltipButton from "./TooltipButton.vue";
import { IconClose, IconPlug } from "../lib/icons";

const { t } = useI18n();
const store = useAppStore();

/** Main queues one prompt per session; the host shows whichever arrived first. */
const queue = ref<TrustedExtensionUiPrompt[]>([]);
/** `ui.setStatus` / `ui.setWorkingMessage` texts per session and key. */
const status = ref<Record<string, Record<string, string>>>({});
const inputRef = ref<HTMLInputElement | null>(null);
const draft = ref("");
const selected = ref<string | undefined>(undefined);

const activeSessionId = computed(() => store.appState?.activeSessionId);
const current = computed(() => queue.value[0]);
const request = computed(() => current.value?.request);
const statusTexts = computed(() =>
  activeSessionId.value ? Object.values(status.value[activeSessionId.value] ?? {}) : [],
);

const dialogId = computed(() =>
  current.value ? `extension-prompt-${current.value.promptId}` : "extension-prompt",
);

const isConfirm = computed(() => request.value?.kind === "confirm");
const isSelect = computed(() => request.value?.kind === "select");
const isInput = computed(() => request.value?.kind === "input");

const title = computed(() => {
  const promptRequest = request.value;
  if (!promptRequest) return "";
  return promptRequest.kind === "confirm" ||
    promptRequest.kind === "select" ||
    promptRequest.kind === "input"
    ? promptRequest.title
    : "";
});

const confirmMessage = computed(() =>
  request.value?.kind === "confirm" ? request.value.message : "",
);
const options = computed(() =>
  request.value?.kind === "select" ? request.value.options : [],
);
const inputPlaceholder = computed(() =>
  request.value?.kind === "input" && request.value.placeholder
    ? request.value.placeholder
    : t("plugins.agentExtension.prompt.placeholder"),
);

/** Answers the prompt through `extensions/ui/respond`; dismissing aborts it. */
function settle(value?: string | boolean) {
  const prompt = current.value;
  if (!prompt) return;
  void api
    .respondExtensionPrompt({ promptId: prompt.promptId, value })
    .catch(() => undefined);
  queue.value = queue.value.filter((item) => item.promptId !== prompt.promptId);
}

function submit() {
  const promptRequest = request.value;
  if (!promptRequest) return;
  if (promptRequest.kind === "confirm") settle(true);
  else if (promptRequest.kind === "select") settle(selected.value);
  else settle(draft.value);
}

/** Overlay presses dismiss; presses inside the dialog must not bubble out. */
function onOverlayClick(event: MouseEvent) {
  if (event.target === event.currentTarget) settle(undefined);
}

/**
 * Per-prompt reset, standing in for the `key={current.promptId}`
 * remount, plus the scroll lock and initial focus run in the
 * dialog's mount effect.
 */
let lockedOverflow: string | null = null;

watch(
  () => current.value?.promptId,
  (promptId) => {
    if (promptId) {
      if (lockedOverflow === null) {
        lockedOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      }
      draft.value = "";
      selected.value =
        request.value?.kind === "select" ? request.value.options[0] : undefined;
      requestAnimationFrame(() => inputRef.value?.focus());
      return;
    }
    if (lockedOverflow !== null) {
      document.body.style.overflow = lockedOverflow;
      lockedOverflow = null;
    }
  },
  { immediate: true },
);

function onKeyDown(event: KeyboardEvent) {
  if (!current.value) return;
  if (event.key !== "Escape") return;
  event.preventDefault();
  settle(undefined);
}

let offPrompt: (() => void) | null = null;
let offStatus: (() => void) | null = null;

onMounted(() => {
  offPrompt = api.onExtensionPrompt((prompt) => {
    if (queue.value.some((item) => item.promptId === prompt.promptId)) return;
    queue.value = [...queue.value, prompt];
  });
  offStatus = api.onExtensionStatus((event: TrustedExtensionStatusEvent) => {
    const session = { ...(status.value[event.sessionId] ?? {}) };
    const key = `${event.extensionId}\u0000${event.key}`;
    if (event.text) session[key] = event.text;
    else delete session[key];
    status.value = { ...status.value, [event.sessionId]: session };
  });
  window.addEventListener("keydown", onKeyDown);
});

onUnmounted(() => {
  offPrompt?.();
  offStatus?.();
  window.removeEventListener("keydown", onKeyDown);
  if (lockedOverflow !== null) {
    document.body.style.overflow = lockedOverflow;
    lockedOverflow = null;
  }
});
</script>

<template>
  <div
    v-if="statusTexts.length"
    class="extension-status-line"
    role="status"
    aria-live="polite"
  >
    <span
      v-for="(text, index) in statusTexts"
      :key="index"
      class="extension-status-item"
    >
      {{ text }}
    </span>
  </div>
  <Teleport v-if="current" to="body">
    <div
      class="overlay session-rename-dialog-overlay extension-prompt-overlay"
      role="presentation"
      @click="onOverlayClick"
    >
      <div
        class="dialog session-rename-dialog extension-prompt-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`${dialogId}-title`"
        :aria-describedby="`${dialogId}-source`"
        @click.stop
      >
        <div class="session-rename-dialog-head">
          <div>
            <h2 :id="`${dialogId}-title`" class="session-rename-dialog-title">
              <IconPlug :size="16" aria-hidden="true" />
              {{ title }}
            </h2>
            <p :id="`${dialogId}-source`" class="session-rename-dialog-description">
              {{ t("plugins.agentExtension.prompt.source", { label: current.extensionLabel }) }}
              <code class="extension-prompt-source-path">{{ current.extensionId }}</code>
            </p>
          </div>
          <TooltipButton
            as="button"
            type="button"
            class="session-rename-dialog-close"
            :aria-label="t('common.cancel')"
            :label="t('common.cancel')"
            @click="settle(undefined)"
          >
            <IconClose :size="16" />
          </TooltipButton>
        </div>
        <form @submit.prevent="submit">
          <p v-if="isConfirm" class="extension-prompt-message">{{ confirmMessage }}</p>
          <div
            v-if="isSelect"
            class="extension-prompt-options"
            role="radiogroup"
            :aria-label="title"
          >
            <label
              v-for="option in options"
              :key="option"
              class="extension-prompt-option"
            >
              <input
                type="radio"
                :name="`${dialogId}-option`"
                :value="option"
                :checked="selected === option"
                @change="selected = option"
              />
              <span>{{ option }}</span>
            </label>
          </div>
          <input
            v-if="isInput"
            ref="inputRef"
            class="field-input"
            :value="draft"
            :placeholder="inputPlaceholder"
            :aria-label="title"
            :spellcheck="false"
            @input="draft = ($event.target as HTMLInputElement).value"
          />
          <div class="session-rename-dialog-actions">
            <Button type="button" variant="ghost" @click="settle(undefined)">
              {{ isConfirm ? t("plugins.agentExtension.prompt.no") : t("common.cancel") }}
            </Button>
            <Button
              type="submit"
              variant="primary"
              :disabled="isSelect && !selected"
            >
              {{
                isConfirm
                  ? t("plugins.agentExtension.prompt.yes")
                  : t("plugins.agentExtension.prompt.ok")
              }}
            </Button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
