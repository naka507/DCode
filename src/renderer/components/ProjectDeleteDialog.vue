<script setup lang="ts">
/**
 * Second confirmation for deleting a project.
 *
 * The `ProjectDeleteDialog` surface. The store action removes the
 * project record and its stored sessions; the folder on disk is never touched.
 *
 * Like `ProjectEditDialog`, the modal contract is hand-rolled, and this dialog
 * uses the same `reka-ui` Dialog primitives as `ProjectCreateDialog.vue`. The
 * four description paragraphs keep their ids so the explicit
 * `aria-describedby` list still resolves; `DialogContent`
 * receives it through attribute fallthrough, which wins over the primitive's
 * own single-id wiring.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import { ErrorCodes } from "@dcode/shared";
import { useAppStore } from "../stores/app-store";
import { overlayRoot } from "../lib/overlay-root";
import Button from "./ui/Button.vue";
import TooltipButton from "./TooltipButton.vue";
import { IconCircleAlert, IconClose, IconStop, IconTrash } from "../lib/icons";

const props = defineProps<{
  project: { name: string; path: string; sessionCount: number };
  /**
   * Sessions of this project whose turn is still live. The host refuses the
   * bulk delete (and the single session delete) while one exists, so the dialog
   * names them and stops them as the explicit step its confirm label promises.
   */
  runningSessionIds: string[];
}>();

const emit = defineEmits<{ close: []; deleted: []; error: [error: unknown] }>();

const { t } = useI18n();
const store = useAppStore();

const busy = ref(false);

// The surfaces that own this dialog subscribe to `runningSessions`, so a turn
// that starts or finishes while the dialog is open is reflected here before
// the user confirms.
const runningCount = computed(() => props.runningSessionIds.length);

/**
 * The dialog never leaves `true` on its own: only the `close` emit unmounts it,
 * and a busy confirm refuses the request 
 */
const open = computed({
  get: () => true,
  set: (value: boolean) => {
    if (value) return;
    if (busy.value) return;
    emit("close");
  },
});

const describedBy = computed(
  () =>
    `project-delete-dialog-description project-delete-dialog-sessions project-delete-dialog-folder-kept${
      runningCount.value > 0 ? " project-delete-dialog-running" : ""
    }`,
);

async function confirm() {
  if (busy.value) return;
  busy.value = true;
  try {
    // A live turn still owns its session's tools and transcript, so the host
    // refuses the bulk delete until every attached session is idle. Stopping
    // the listed sessions is the step the confirm button names; a turn that
    // starts after this loop still makes the host refuse with CONFLICT below,
    // which is why the refusal path stays reachable.
    for (const sessionId of props.runningSessionIds) {
      await store.appState?.abortSession(sessionId);
    }
    await store.appState?.deleteProject(props.project.path);
    emit("deleted");
  } catch (error) {
    // The host refuses the delete while a task of this project is running;
    // show the same localized explanation the menu guard used to show.
    if ((error as { errorCode?: unknown } | null)?.errorCode === ErrorCodes.CONFLICT) {
      emit("error", new Error(t("project.deleteRunningBlocked")));
      return;
    }
    emit("error", error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal :to="overlayRoot()">
      <DialogOverlay class="overlay project-instructions-dialog-overlay">
        <DialogContent
          class="dialog project-instructions-dialog project-delete-dialog"
          :aria-modal="true"
          :aria-describedby="describedBy"
          tabindex="-1"
        >
          <div class="project-instructions-dialog-head">
            <div>
              <DialogTitle class="project-instructions-dialog-title">
                <IconCircleAlert :size="17" aria-hidden="true" />
                {{ t("project.deleteTitle") }}
              </DialogTitle>
              <div class="project-instructions-dialog-project">{{ project.name }}</div>
            </div>
            <TooltipButton
              as="button"
              type="button"
              class="project-instructions-dialog-close"
              :label="t('project.deleteCancel')"
              :aria-label="t('project.deleteCancel')"
              :disabled="busy"
              @click="emit('close')"
            >
              <IconClose :size="16" />
            </TooltipButton>
          </div>
          <div class="project-delete-dialog-body">
            <DialogDescription
              id="project-delete-dialog-description"
              class="project-memory-dialog-description"
            >
              {{ t("project.deleteDescription", { name: project.name }) }}
            </DialogDescription>
            <p id="project-delete-dialog-sessions" class="project-delete-dialog-warning">
              <IconTrash :size="14" aria-hidden="true" />
              <span>{{ t("project.deleteSessions", { count: project.sessionCount }) }}</span>
            </p>
            <p v-if="runningCount > 0" id="project-delete-dialog-running" class="project-delete-dialog-running">
              <IconStop :size="14" aria-hidden="true" />
              <span>{{ t("project.deleteRunning", { count: runningCount }) }}</span>
            </p>
            <p id="project-delete-dialog-folder-kept" class="project-memory-dialog-hint">
              {{ t("project.deleteFolderKept") }}
            </p>
          </div>
          <div class="project-instructions-dialog-actions">
            <Button type="button" variant="ghost" :disabled="busy" @click="emit('close')">
              {{ t("project.deleteCancel") }}
            </Button>
            <Button
              type="button"
              variant="primary"
              class="project-delete-dialog-confirm"
              :disabled="busy"
              @click="confirm"
            >
              {{
                busy
                  ? t("project.deleting")
                  : runningCount > 0
                    ? t("project.deleteRunningConfirm")
                    : t("project.deleteConfirm")
              }}
            </Button>
          </div>
        </DialogContent>
      </DialogOverlay>
    </DialogPortal>
  </DialogRoot>
</template>
