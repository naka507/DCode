<script setup lang="ts">
/**
 * Session rename dialog.
 *
 * The `SessionRenameDialog` component. This file holds two
 * components: a generic `RenameDialog` (every visible string is a prop) and the
 * exported `SessionRenameDialog` wrapper that fills those props from the
 * catalog. Only the wrapper is imported anywhere, so the generic half is folded
 * into this single SFC rather than becoming a second file: the markup, class
 * names, ids and behaviour are unchanged, and the exported surface is
 * unchanged.
 *
 * The modal contract used to be hand-rolled (Escape-to-close with a
 * `savingRef` guard, Tab wrap, `body.style.overflow`, focus restore, overlay
 * click). This component uses the same `reka-ui` Dialog primitives as
 * `ProjectCreateDialog.vue` for all of that; the save-in-flight
 * guard survives as the `open` setter, which refuses to close while saving.
 */
import { computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import { MAX_SESSION_TITLE_LENGTH } from "@dcode/shared";
import type { SessionSummary } from "@dcode/shared";
import { overlayRoot } from "../lib/overlay-root";
import Button from "./ui/Button.vue";
import TooltipButton from "./TooltipButton.vue";
import { IconClose, IconPencil } from "../lib/icons";

const props = defineProps<{
  session: Pick<SessionSummary, "id" | "title">;
}>();

const emit = defineEmits<{
  close: [];
  saved: [title: string];
  error: [error: unknown];
}>();

const { t } = useI18n();

const draft = ref(props.session.title);
const saving = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);

/** The dialog leaves `true` only through the `close` emit. */
const open = computed({
  get: () => true,
  set: (value: boolean) => {
    if (value || saving.value) return;
    emit("close");
  },
});

const canSave = computed(() => Boolean(draft.value.trim()) && !saving.value);

onMounted(() => {
  void nextTick(() => {
    inputRef.value?.focus();
    inputRef.value?.select();
  });
});

/** The draft is capped by code points, not UTF-16 units. */
function onInput(event: Event) {
  const target = event.target as HTMLInputElement;
  draft.value = Array.from(target.value).slice(0, MAX_SESSION_TITLE_LENGTH).join("");
}

async function save() {
  const nextValue = draft.value.trim();
  if (!nextValue || saving.value) return;
  saving.value = true;
  try {
    emit("saved", nextValue);
    emit("close");
  } catch (error) {
    emit("error", error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal :to="overlayRoot()">
      <DialogOverlay class="overlay session-rename-dialog-overlay">
        <DialogContent
          class="dialog session-rename-dialog"
          :aria-modal="true"
          aria-describedby="session-rename-dialog-description"
        >
          <div class="session-rename-dialog-head">
            <div>
              <DialogTitle id="session-rename-dialog-title" class="session-rename-dialog-title">
                <IconPencil :size="16" aria-hidden="true" />
                {{ t("session.renameTitle") }}
              </DialogTitle>
              <DialogDescription
                id="session-rename-dialog-description"
                class="session-rename-dialog-description"
              >
                {{ t("session.renameDescription") }}
              </DialogDescription>
            </div>
            <TooltipButton
              as="button"
              type="button"
              class="session-rename-dialog-close"
              :label="t('session.renameCancel')"
              :aria-label="t('session.renameCancel')"
              :disabled="saving"
              @click="emit('close')"
            >
              <IconClose :size="16" />
            </TooltipButton>
          </div>
          <form @submit.prevent="save">
            <label class="session-rename-dialog-label" for="session-rename-input">
              {{ t("session.renameLabel") }}
            </label>
            <input
              id="session-rename-input"
              ref="inputRef"
              class="field-input"
              :value="draft"
              :aria-label="t('session.renameLabel')"
              spellcheck="false"
              autocorrect="off"
              autocapitalize="off"
              :disabled="saving"
              @input="onInput"
            />
            <div class="session-rename-dialog-meta">
              <span>{{ t("session.renameHint") }}</span>
              <span>{{ Array.from(draft).length }}/{{ MAX_SESSION_TITLE_LENGTH }}</span>
            </div>
            <div class="session-rename-dialog-actions">
              <Button type="button" variant="ghost" :disabled="saving" @click="emit('close')">
                {{ t("session.renameCancel") }}
              </Button>
              <Button type="submit" variant="primary" :disabled="!canSave">
                {{ saving ? t("session.renameSaving") : t("session.renameSave") }}
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogOverlay>
    </DialogPortal>
  </DialogRoot>
</template>
