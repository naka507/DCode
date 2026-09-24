<script setup lang="ts">
/**
 * The detail half of the open project card.
 *
 * The `ProjectDetailPanel` component. The selected
 * row above already carries the name, the status tag and the path, so this panel
 * never repeats them: it opens with the action bar, then the read-only facts
 * (folders and branch), then the sessions section.
 *
 * Design notes:
 *  - The `actions` slot exists because the anchored menu is
 *    owned by the page that holds the project state.
 *  - `onOpenSession` / `onNewTask` / `onRenameSession` / `onShowMore` /
 *    `onShowLess` are the `open-session` / `new-task` / `rename-session` /
 *    `show-more` / `show-less` emits.
 *  - The per-session local (`title`) and the per-session formatted
 *    timestamp are derived in a `sessions` computed, because a Vue template
 *    cannot declare locals per iteration. The prop still decides what renders:
 *    `sessions` is the already-sliced batch the caller passes.
 *  - `TooltipButton`'s `tooltip` / `ariaLabel` props are this component's
 *    `label` / `aria-label`.
 *  - `aria-hidden` is written as `aria-hidden="true"`, never bare.
 */

import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Button from "../../components/ui/Button.vue";
import TooltipButton from "../../components/TooltipButton.vue";
import {
  formatUpdated,
  sessionTimestamp,
  shortenPath,
  type ProjectIndexItem,
  type SessionIndexRecord,
} from "../../lib/project-archive";
import { IconBranch, IconChat, IconFolder, IconPencil, IconPlus } from "../../lib/icons";

const props = defineProps<{
  project: ProjectIndexItem;
  /** Already sliced to the visible batch. */
  sessions: readonly SessionIndexRecord[];
  /** Rows the session list is allowed to render (matches the section label). */
  displayedCount: number;
  hiddenCount: number;
  initialCount: number;
  locale?: string;
}>();

const emit = defineEmits<{
  "open-session": [sessionId: string];
  "new-task": [];
  "rename-session": [session: SessionIndexRecord];
  "show-more": [];
  "show-less": [];
}>();

const { t } = useI18n();

/** One rendered session row: the map callback's locals, hoisted. */
const rows = computed(() =>
  props.sessions.map((session) => ({
    session,
    title: session.title || session.id,
    updated: formatUpdated(
      sessionTimestamp(session.updatedAt),
      props.locale,
      t("project.updatedNever"),
    ),
  })),
);

const roots = computed(() =>
  props.project.roots.map((root) => ({ ...root, short: shortenPath(root.path) })),
);
</script>

<template>
  <div class="projects-detail-bar">
    <Button size="sm" variant="ghost" class="projects-detail-new" @click="emit('new-task')">
      <IconPlus :size="13" />
      {{ t("project.newTask") }}
    </Button>
    <slot name="actions" />
  </div>

  <div class="projects-detail-facts">
    <div class="projects-detail-roots" role="group" :aria-label="t('project.foldersLabel')">
      <span
        v-for="root in roots"
        :key="root.path"
        class="projects-detail-root"
        :title="root.path"
      >
        <IconFolder :size="12" aria-hidden="true" />
        <span>{{ root.short }}</span>
      </span>
    </div>
    <span
      v-if="project.branch"
      class="projects-detail-root is-branch"
      :title="project.branch"
    >
      <IconBranch :size="12" aria-hidden="true" />
      <span>{{ project.branch }}</span>
    </span>
  </div>

  <div class="projects-detail-header">
    <div class="projects-detail-label">
      {{ t("project.sessionsCount", { count: displayedCount }) }}
    </div>
  </div>

  <div v-if="displayedCount === 0" class="projects-detail-empty">
    {{ t("project.noSessions") }}
  </div>
  <div v-else class="projects-detail-tasks">
    <div
      v-for="row in rows"
      :key="row.session.id"
      class="projects-detail-task-row"
      @contextmenu.prevent="emit('rename-session', row.session)"
    >
      <button
        type="button"
        class="projects-detail-task"
        :title="row.title"
        @click="emit('open-session', row.session.id)"
      >
        <IconChat :size="13" class="projects-detail-task-icon" />
        <span class="projects-detail-task-title">{{ row.title }}</span>
        <span class="projects-detail-task-updated">{{ row.updated }}</span>
      </button>
      <TooltipButton
        as="button"
        type="button"
        class="projects-detail-task-rename"
        :label="t('session.renameAction', { title: row.title })"
        :aria-label="t('session.renameAction', { title: row.title })"
        @click="emit('rename-session', row.session)"
      >
        <IconPencil :size="13" aria-hidden="true" />
      </TooltipButton>
    </div>
  </div>

  <Button
    v-if="hiddenCount > 0"
    size="sm"
    variant="ghost"
    class="projects-detail-more"
    @click="emit('show-more')"
  >
    {{ t("project.showMoreSessions", { count: hiddenCount }) }}
  </Button>
  <Button
    v-else-if="displayedCount > initialCount"
    size="sm"
    variant="ghost"
    class="projects-detail-more"
    @click="emit('show-less')"
  >
    {{ t("project.showFewerSessions") }}
  </Button>
</template>
