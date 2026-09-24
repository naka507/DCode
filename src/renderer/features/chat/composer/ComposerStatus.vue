<script setup lang="ts">
/**
 * Non-editor composer status rows: queue, enhancement errors, and folder drops.
 *
 * The `ComposerStatus` component.
 *
 * The decisions that are not mechanical:
 *
 * 1. **`t` is not a prop.** The i18next `TFunction` used to be threaded down from
 *     the Composer; every component here reads the same instance through
 *     `useI18n()` instead.
 * 2. **The eight callbacks become emits.** They used to be passed as props
 *     without the `on` prefix (`removeQueuedPrompt={...}`), so the emit names
 *     are the kebab-case of those prop names: `remove-queued-prompt`,
 *     `move-queued-prompt`, `edit-queued-prompt`, `send-queued-now`,
 *     `clear-enhancement-error`, `open-dropped-folder-as-project`,
 *     `insert-dropped-directory-paths`, `dismiss-dropped-directories`.
 * 3. **Per-row derivations move into one `computed`.** `label` / `promoted` /
 *     `sendNowLocked` / `actionLabel` used to be recomputed inside the
 *     `.map()`; the rows are built once here, which is the same sequence with
 *     no work during render. `actionLabel` is applied to each tooltip and
 * `aria-label` exactly where the row is rendered.
 *  4. **The disabled row actions still explain themselves.** `promoted` drives
 *     both `disabled` and `aria-disabled`; `TooltipButton` shows its tooltip on
 *     a disabled anchor (`showWhenDisabled`), which is what
 *     `TooltipButton` does too.
 *  5. `t("project.droppedFolder", { count, defaultValue })` loses the inline
 *     fallback: the key is present in every shipped catalog.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  IconArrowDown,
  IconArrowUp,
  IconFolder,
  IconPencil,
  IconX,
} from "../../../lib/icons";
import type { ComposerDropItem } from "../../../lib/composer-drop";
import {
  isPendingQueuedPrompt,
  isPromotedQueuedPrompt,
  type QueuedPrompt,
} from "../../../lib/queued-prompts";
import TooltipButton from "../../../components/TooltipButton.vue";

const props = defineProps<{
  queuedPrompts: readonly QueuedPrompt[];
  approvalPending: boolean;
  enhancementError: { message: string; code: string } | null;
  droppedDirectories: ComposerDropItem[];
}>();

const emit = defineEmits<{
  "remove-queued-prompt": [id: string];
  "move-queued-prompt": [id: string, direction: "up" | "down"];
  "edit-queued-prompt": [id: string];
  "send-queued-now": [id: string];
  "clear-enhancement-error": [];
  "open-dropped-folder-as-project": [];
  "insert-dropped-directory-paths": [];
  "dismiss-dropped-directories": [];
}>();

const { t } = useI18n();

type QueuedRow = {
  id: string;
  label: string;
  promoted: boolean;
  sendNowLocked: boolean;
  moveUpLabel: string;
  moveDownLabel: string;
  editLabel: string;
  removeLabel: string;
};

/**
 * A promoted row is already the next turn: every edit action is locked, and the
 * disabled controls say why instead of going quiet.
 */
function actionLabel(promoted: boolean, action: string): string {
  return promoted ? `${action} · ${t("chat.sendNowPending")}` : action;
}

const queuedRows = computed<QueuedRow[]>(() =>
  props.queuedPrompts.map((item) => {
    const label =
      item.content.trim() ||
      item.draft.fileReferences.map((reference) => reference.name).join(", ") ||
      t("chat.queuedPromptEmpty");
    const promoted = isPromotedQueuedPrompt(item);
    return {
      id: item.id,
      label,
      promoted,
      sendNowLocked:
        props.approvalPending || promoted || isPendingQueuedPrompt(item),
      moveUpLabel: actionLabel(promoted, t("chat.moveQueuedPromptUp")),
      moveDownLabel: actionLabel(promoted, t("chat.moveQueuedPromptDown")),
      editLabel: actionLabel(promoted, t("chat.editQueuedPrompt")),
      removeLabel: actionLabel(promoted, t("chat.removeQueuedPrompt")),
    };
  }),
);

const droppedFolderLabel = computed(() =>
  t("project.droppedFolder", { count: props.droppedDirectories.length }),
);
</script>

<template>
  <div
    v-if="props.queuedPrompts.length"
    class="composer-queued-prompts"
    role="list"
    :aria-label="t('chat.queuedPrompts')"
  >
    <div
      v-for="row in queuedRows"
      :key="row.id"
      class="composer-queued-prompt"
      role="listitem"
      data-testid="queued-prompt"
      :data-priority="row.promoted ? 'true' : 'false'"
    >
      <span class="composer-queued-prompt-text" :title="row.label">
        {{ row.label }}
      </span>
      <TooltipButton
        type="button"
        class="composer-queued-prompt-action composer-queued-prompt-move-up"
        :label="row.moveUpLabel"
        :aria-label="row.moveUpLabel"
        :disabled="row.promoted"
        :aria-disabled="row.promoted"
        @click="emit('move-queued-prompt', row.id, 'up')"
      >
        <IconArrowUp :size="13" aria-hidden="true" />
      </TooltipButton>
      <TooltipButton
        type="button"
        class="composer-queued-prompt-action composer-queued-prompt-move-down"
        :label="row.moveDownLabel"
        :aria-label="row.moveDownLabel"
        :disabled="row.promoted"
        :aria-disabled="row.promoted"
        @click="emit('move-queued-prompt', row.id, 'down')"
      >
        <IconArrowDown :size="13" aria-hidden="true" />
      </TooltipButton>
      <button
        type="button"
        class="composer-queued-prompt-send-now"
        :disabled="row.sendNowLocked"
        :aria-disabled="row.sendNowLocked"
        @click="emit('send-queued-now', row.id)"
      >
        {{ row.promoted ? t("chat.sendNowPending") : t("chat.sendNow") }}
      </button>
      <TooltipButton
        type="button"
        class="composer-queued-prompt-action composer-queued-prompt-edit"
        :label="row.editLabel"
        :aria-label="row.editLabel"
        :disabled="row.promoted"
        :aria-disabled="row.promoted"
        @click="emit('edit-queued-prompt', row.id)"
      >
        <IconPencil :size="13" aria-hidden="true" />
      </TooltipButton>
      <TooltipButton
        type="button"
        class="composer-queued-prompt-action composer-queued-prompt-remove"
        :label="row.removeLabel"
        :aria-label="row.removeLabel"
        :disabled="row.promoted"
        :aria-disabled="row.promoted"
        @click="emit('remove-queued-prompt', row.id)"
      >
        <IconX :size="13" aria-hidden="true" />
      </TooltipButton>
    </div>
  </div>
  <div v-if="props.enhancementError" class="composer-enhancement-error" role="alert">
    <span class="composer-enhancement-error-message">
      {{ t("chat.enhancementFailed") }}: {{ props.enhancementError.message }}
    </span>
    <code>{{ props.enhancementError.code }}</code>
    <TooltipButton
      type="button"
      class="composer-enhancement-error-dismiss"
      :label="t('chat.dismissEnhancementError')"
      :aria-label="t('chat.dismissEnhancementError')"
      @click="emit('clear-enhancement-error')"
    >
      <IconX :size="13" aria-hidden="true" />
    </TooltipButton>
  </div>
  <div v-if="props.droppedDirectories.length" class="composer-directory-drop" role="status">
    <IconFolder :size="13" aria-hidden="true" />
    <span class="composer-directory-drop-name">
      {{ droppedFolderLabel }}
    </span>
    <button
      type="button"
      class="composer-directory-drop-action"
      data-action="open-dropped-folder-project"
      @click="emit('open-dropped-folder-as-project')"
    >
      {{ t("project.openAsProject") }}
    </button>
    <button
      type="button"
      class="composer-directory-drop-action"
      data-action="reference-dropped-folder"
      @click="emit('insert-dropped-directory-paths')"
    >
      {{ t("project.referenceFolder") }}
    </button>
    <TooltipButton
      type="button"
      class="composer-directory-drop-dismiss"
      :label="t('nav.dismissFolderDrop')"
      :aria-label="t('nav.dismissFolderDrop')"
      @click="emit('dismiss-dropped-directories')"
    >
      <IconX :size="13" aria-hidden="true" />
    </TooltipButton>
  </div>
</template>
