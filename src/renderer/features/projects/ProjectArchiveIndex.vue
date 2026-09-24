<script setup lang="ts">
/**
 * The project index: one inset grouped list of the archive's rows.
 *
 * The `ProjectArchiveIndex` component. The
 * framework-free half (`projectStatus`, `shortenPath`, `formatUpdated`,
 * `GROUP_LABEL_KEYS`, `PROJECT_STATUS_LABEL_KEYS`, `projectRowId`) lives in
 * `lib/project-archive.ts`; this SFC is the markup.
 *
 * Design notes:
 *  - The `detail` slot is only placed inside the
 *    open row, so the parent can hand over the one card it holds and no other
 *    row renders it.
 *  - `onSelect` / `onActivate` are the `select` / `activate` emits.
 *  - `cx(...)` is a static `class` plus an object `:class` binding, which is the
 *    form the class-name contract reads. The status tag builds its modifier with
 *    a template literal (`` `is-${status}` ``); spelling the two
 *    values as object keys keeps the literal names visible and the reference DOM
 *    unchanged.
 *  - The row map's per-row locals (`open`, `status`, `color`, `totalSessions`)
 *    are hoisted into one `sections` computed: a Vue template cannot declare
 *    locals per iteration. The prop still decides what is rendered — this
 *    computed only derives from it.
 *  - `aria-hidden` is written as `aria-hidden="true"`, never bare.
 */

import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { projectColor } from "../../lib/recent-projects";
import {
  formatUpdated,
  GROUP_LABEL_KEYS,
  PROJECT_STATUS_LABEL_KEYS,
  projectRowId,
  projectStatus,
  shortenPath,
  type GroupId,
  type ProjectIndexItem,
  type ProjectStatus,
} from "../../lib/project-archive";
import { IconChevronRight, IconFolder, IconStar } from "../../lib/icons";

const props = defineProps<{
  groups: { id: GroupId; rows: ProjectIndexItem[] }[];
  /** Path whose card is open, or `null` while the index is only a list. */
  openPath: string | null;
  workspacePath?: string | null;
  openProjectPaths: readonly string[];
  locale?: string;
  sessionCounts: Map<string, number>;
}>();

const emit = defineEmits<{
  select: [path: string];
  activate: [path: string];
}>();

const { t } = useI18n();

/** One rendered row: the map callback's locals, hoisted. */
type IndexRow = {
  project: ProjectIndexItem;
  rowId: string;
  open: boolean;
  status: ProjectStatus | null;
  color: string;
  updated: string;
  sessions: string;
};

const sections = computed(() =>
  props.groups.map((group) => ({
    id: group.id,
    label: t(GROUP_LABEL_KEYS[group.id]),
    count: group.rows.length,
    rows: group.rows.map<IndexRow>((project) => ({
      project,
      rowId: projectRowId(project.path),
      open: props.openPath === project.path,
      status: projectStatus({
        project,
        workspacePath: props.workspacePath,
        openProjectPaths: props.openProjectPaths,
      }),
      color: project.color || projectColor(project.path),
      updated: formatUpdated(
        project.openedAt,
        props.locale,
        t("project.updatedNever"),
      ),
      sessions: t("project.sessionsCount", {
        count: props.sessionCounts.get(project.path) ?? 0,
      }),
    })),
  })),
);

/** Label of a row's state tag, or "" for a plain project. */
function statusLabel(status: ProjectStatus | null): string {
  return status ? t(PROJECT_STATUS_LABEL_KEYS[status]) : "";
}
</script>

<template>
  <div class="projects-index">
    <section
      v-for="group in sections"
      :key="group.id"
      class="projects-group"
      :aria-labelledby="`projects-group-${group.id}`"
    >
      <div class="projects-group-head">
        <h3 :id="`projects-group-${group.id}`" class="projects-group-label">
          {{ group.label }}
        </h3>
        <span class="projects-group-count">{{ group.count }}</span>
      </div>
      <div class="projects-group-rows" role="list">
        <div
          v-for="row in group.rows"
          :id="row.rowId"
          :key="row.project.path"
          role="listitem"
          class="projects-row-block"
          :class="{
            open: row.open,
            active: row.status === 'active',
            archived: row.status === 'archived',
          }"
        >
          <button
            type="button"
            class="projects-row"
            :title="row.project.path"
            :aria-label="t('project.selectProject', { name: row.project.name })"
            :aria-expanded="row.open"
            :aria-current="row.open ? 'true' : undefined"
            @click="emit('select', row.project.path)"
            @dblclick="emit('activate', row.project.path)"
          >
            <span class="projects-glyph" :style="{ background: row.color }">
              <IconStar
                v-if="row.project.pinned"
                :size="15"
                fill="currentColor"
                aria-hidden="true"
              />
              <IconFolder v-else :size="15" aria-hidden="true" />
            </span>
            <span class="projects-name-copy">
              <span class="projects-name-title">
                <span class="projects-name-text">{{ row.project.name }}</span>
                <span
                  v-if="row.status"
                  class="projects-tag"
                  :class="{
                    'is-active': row.status === 'active',
                    'is-archived': row.status === 'archived',
                  }"
                >
                  {{ statusLabel(row.status) }}
                </span>
              </span>
              <span class="projects-name-path">{{ shortenPath(row.project.path) }}</span>
            </span>
            <span class="projects-row-meta">
              <span class="projects-name-sessions">{{ row.sessions }}</span>
              <span class="projects-updated">{{ row.updated }}</span>
            </span>
            <span class="projects-row-disclosure" aria-hidden="true">
              <IconChevronRight :size="14" />
            </span>
          </button>
          <div
            v-if="row.open"
            class="projects-inspector"
            role="region"
            :aria-label="row.project.name"
          >
            <slot name="detail" />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
