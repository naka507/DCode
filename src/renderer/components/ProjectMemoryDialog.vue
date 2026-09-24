<script setup lang="ts">
/**
 * Project memory dialog.
 *
 * The `ProjectMemoryDialog` surface. The earlier implementation hand-rolled the whole
 * modal contract (Escape with a `saving` guard, `body.style.overflow`, focus
 * restore, overlay click), so this dialog uses the same `reka-ui` Dialog
 * primitives as `ProjectCreateDialog.vue` /
 * `ProjectEditDialog.vue` / `ProjectDeleteDialog.vue` instead of
 * re-implementing any of it. The save-in-flight guard survives as the `open`
 * setter, which refuses to close while a save is running — the guard covers
 * both Escape and the overlay click that way.
 *
 * The four pure entry helpers (`newEntry`, `entriesFromMemory`,
 * `normalizeEntries`, `entriesEqual`) are the framework-free half of the
 * original module and live in `components/project-memory-dialog.ts`.
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
import type { ProjectMemory, ProjectMemoryEntry } from "@dcode/shared";
import { api } from "../lib/api";
import { overlayRoot } from "../lib/overlay-root";
import Button from "./ui/Button.vue";
import Input from "./ui/Input.vue";
import Textarea from "./ui/Textarea.vue";
import TooltipButton from "./TooltipButton.vue";
import { IconClose, IconPlus, IconSparkles, IconTrash } from "../lib/icons";
import {
  entriesEqual,
  entriesFromMemory,
  newEntry,
  normalizeEntries,
} from "./project-memory-dialog";

const props = defineProps<{
  project: { name: string; path: string; groupId?: string; legacy?: boolean };
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
  error: [error: unknown];
}>();

const { t } = useI18n();

const memory = ref<ProjectMemory | null>(null);
const entries = ref<ProjectMemoryEntry[]>([]);
const savedEntries = ref<ProjectMemoryEntry[]>([]);
const saving = ref(false);

/**
 * The dialog never leaves `true` on its own: only the `close` emit unmounts it,
 * and a busy save refuses every dismissal path reka-ui offers (Escape, outside
 * pointer press), matching the `!saving` guards.
 */
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
        ? api.getProjectGroupMemory(groupId)
        : api.getProjectMemory(path);
    void load
      .then((result) => {
        if (cancelled) return;
        const loadedEntries = entriesFromMemory(result.memory);
        memory.value = result.memory;
        entries.value = loadedEntries;
        savedEntries.value = loadedEntries;
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

function updateEntry(id: string, patch: Partial<ProjectMemoryEntry>) {
  entries.value = entries.value.map((entry) =>
    entry.id === id ? { ...entry, ...patch } : entry,
  );
}

async function save() {
  const normalized = normalizeEntries(entries.value);
  saving.value = true;
  try {
    const result =
      props.project.groupId && !props.project.legacy
        ? await api.saveProjectGroupMemory(props.project.groupId, normalized)
        : await api.saveProjectMemory(props.project.path, normalized);
    const saved = entriesFromMemory(result.memory);
    memory.value = result.memory;
    entries.value = saved;
    savedEntries.value = saved;
    emit("saved");
  } catch (error) {
    emit("error", error);
  } finally {
    saving.value = false;
  }
}

const dirty = computed(
  () => memory.value !== null && !entriesEqual(entries.value, savedEntries.value),
);

const inputDisabled = computed(() => memory.value === null || saving.value);
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal :to="overlayRoot()">
      <DialogOverlay class="overlay project-instructions-dialog-overlay">
        <DialogContent
          class="dialog project-instructions-dialog project-memory-dialog"
          :aria-modal="true"
        >
          <div class="project-instructions-dialog-head">
            <div>
              <DialogTitle as="h3" class="project-instructions-dialog-title">
                <IconSparkles :size="17" aria-hidden="true" />
                {{ t("project.editMemory") }}
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
          <p class="project-memory-dialog-description">{{ t("project.memoryDescription") }}</p>
          <div class="project-memory-dialog-toolbar">
            <span class="project-memory-dialog-count">
              {{ t("project.memoryCount", { count: entries.length }) }}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              :disabled="inputDisabled"
              @click="entries = [...entries, newEntry()]"
            >
              <IconPlus :size="14" aria-hidden="true" />
              {{ t("project.memoryAdd") }}
            </Button>
          </div>
          <div v-if="entries.length > 0" class="project-memory-dialog-list" role="list">
            <article
              v-for="(entry, index) in entries"
              :key="entry.id"
              class="project-memory-card"
              role="listitem"
            >
              <div class="project-memory-card-head">
                <span class="project-memory-entry-index" aria-hidden="true">
                  {{ index + 1 }}
                </span>
                <Input
                  :value="entry.title"
                  :placeholder="t('project.memoryEntryTitle')"
                  :aria-label="t('project.memoryEntryTitle')"
                  :disabled="inputDisabled"
                  @input="
                    updateEntry(entry.id, {
                      title: ($event.target as HTMLInputElement).value,
                    })
                  "
                />
                <TooltipButton
                  as="button"
                  type="button"
                  class="project-memory-remove"
                  :label="t('project.memoryRemove')"
                  :aria-label="t('project.memoryRemove')"
                  :disabled="saving"
                  @click="entries = entries.filter((item) => item.id !== entry.id)"
                >
                  <IconTrash :size="15" />
                </TooltipButton>
              </div>
              <Textarea
                class="project-memory-entry-content"
                :value="entry.content"
                :placeholder="t('project.memoryEntryContent')"
                :aria-label="t('project.memoryEntryContent')"
                :disabled="inputDisabled"
                @input="
                  updateEntry(entry.id, {
                    content: ($event.target as HTMLTextAreaElement).value,
                  })
                "
              />
            </article>
          </div>
          <div v-else class="project-memory-dialog-empty">
            <IconSparkles :size="20" aria-hidden="true" />
            <span>{{ t("project.memoryEmpty") }}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              :disabled="inputDisabled"
              @click="entries = [newEntry()]"
            >
              <IconPlus :size="14" aria-hidden="true" />
              {{ t("project.memoryAdd") }}
            </Button>
          </div>
          <div class="project-memory-dialog-hint">{{ t("project.memoryHint") }}</div>
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
              {{ saving ? t("project.memorySaving") : t("project.memorySave") }}
            </Button>
          </div>
        </DialogContent>
      </DialogOverlay>
    </DialogPortal>
  </DialogRoot>
</template>
