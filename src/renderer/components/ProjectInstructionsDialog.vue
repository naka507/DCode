<script setup lang="ts">
/**
 * Project instructions dialog.
 *
 * The `ProjectInstructionsDialog` surface. The earlier implementation hand-rolled the
 * modal contract (Escape with a `saving` guard, `body.style.overflow`, focus
 * restore, overlay click), so this dialog uses the same `reka-ui` Dialog
 * primitives as `ProjectCreateDialog.vue` /
 * `ProjectEditDialog.vue` instead of re-implementing any of it. The
 * save-in-flight guard survives as the `open` setter, which refuses to close
 * while a save is running — the guard covers Escape and the overlay click
 * that way.
 *
 * The module has no framework-free half: the whole file was one component, so
 * there is no `.ts` beside it.
 *
 * `project` keeps its earlier shape; `onClose` / `onSaved` / `onError` become
 * the `close` / `saved` / `error` emits.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import type { AgentInstructionFile } from "@dcode/shared";
import { api } from "../lib/api";
import { overlayRoot } from "../lib/overlay-root";
import Button from "./ui/Button.vue";
import Textarea from "./ui/Textarea.vue";
import TooltipButton from "./TooltipButton.vue";
import { IconClose } from "../lib/icons";

const props = defineProps<{
  project: { name: string; path: string; groupId?: string; legacy?: boolean };
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
  error: [error: unknown];
}>();

const { t } = useI18n();

const file = ref<AgentInstructionFile | null>(null);
const draft = ref("");
const saving = ref(false);

/** The dialog leaves `true` only through the `close` emit. */
const open = computed({
  get: () => true,
  set: (value: boolean) => {
    if (value) return;
    if (saving.value) return;
    emit("close");
  },
});

watch(
  () => [props.project.groupId, props.project.legacy, props.project.path] as const,
  ([groupId, legacy, path], _previous, onCleanup) => {
    let cancelled = false;
    const load =
      groupId && !legacy
        ? api.getProjectGroupInstructions(groupId).then((result) => ({
            project: {
              scope: "project" as const,
              path: "ChatGPT Project instructions",
              content: result.content,
              exists: true,
            },
          }))
        : api.getAgentInstructions(path);
    void load
      .then((result) => {
        if (cancelled || !result.project) return;
        file.value = result.project;
        draft.value = result.project.content;
      })
      .catch((error: unknown) => {
        if (!cancelled) emit("error", error);
      });
    onCleanup(() => {
      cancelled = true;
    });
  },
  { immediate: true },
);

async function save() {
  saving.value = true;
  try {
    if (props.project.groupId && !props.project.legacy) {
      const result = await api.saveProjectGroupInstructions(
        props.project.groupId,
        draft.value,
      );
      file.value = file.value
        ? { ...file.value, content: result.content, exists: true }
        : file.value;
    } else {
      const result = await api.saveAgentInstructions(
        "project",
        draft.value,
        props.project.path,
      );
      file.value = result.file;
    }
    emit("saved");
  } catch (error) {
    emit("error", error);
  } finally {
    saving.value = false;
  }
}

const dirty = computed(
  () => file.value !== null && draft.value !== file.value.content,
);

const editorDisabled = computed(() => !file.value || saving.value);
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal :to="overlayRoot()">
      <DialogOverlay class="overlay project-instructions-dialog-overlay">
        <DialogContent
          class="dialog project-instructions-dialog"
          :aria-modal="true"
        >
          <div class="project-instructions-dialog-head">
            <div>
              <DialogTitle as="h3" class="project-instructions-dialog-title">
                {{ t("project.editInstructions") }}
              </DialogTitle>
              <div class="project-instructions-dialog-project">{{ project.name }}</div>
            </div>
            <TooltipButton
              as="button"
              type="button"
              class="project-instructions-dialog-close"
              :label="t('settings.cancel')"
              :aria-label="t('settings.cancel')"
              :disabled="saving"
              @click="emit('close')"
            >
              <IconClose :size="16" />
            </TooltipButton>
          </div>
          <div class="project-instructions-dialog-path">{{ file?.path ?? "" }}</div>
          <Textarea
            class="settings-instruction-editor project-instructions-dialog-editor"
            :value="draft"
            :aria-label="t('project.editInstructions')"
            :disabled="editorDisabled"
            @input="draft = ($event.target as HTMLTextAreaElement).value"
          />
          <div class="project-instructions-dialog-actions">
            <Button type="button" variant="ghost" :disabled="saving" @click="emit('close')">
              {{ t("settings.cancel") }}
            </Button>
            <Button
              type="button"
              variant="primary"
              :disabled="!dirty || saving"
              @click="save"
            >
              {{ saving ? t("settings.saving") : t("settings.instructionsSave") }}
            </Button>
          </div>
        </DialogContent>
      </DialogOverlay>
    </DialogPortal>
  </DialogRoot>
</template>
