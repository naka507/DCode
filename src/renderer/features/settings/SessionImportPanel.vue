<script setup lang="ts">
/**
 * Import sessions from other agent tools (Settings �?Import).
 *
 * A scan fills the candidate list;
 * the toolbar selects all or a group, groups collapse, and the import reports
 * imported/skipped/failed through a toast before refreshing the sidebar.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { api, type ImportCandidate } from "../../lib/api";
import {
  DEFAULT_IMPORT_GROUP_BY,
  formatImportDate,
  groupImportCandidates,
  type ImportGroupBy,
} from "../../lib/import-groups";
import { useAppStore } from "../../stores/app-store";
import { IconChevronLeft } from "../../lib/icons";
import Badge from "../../components/ui/Badge.vue";
import Button from "../../components/ui/Button.vue";
import HelpIcon from "../../components/ui/HelpIcon.vue";
import SettingsMenuSelect from "../../components/settings/SettingsMenuSelect.vue";
import SettingsCard from "./primitives/SettingsCard.vue";
import SettingsRow from "./primitives/SettingsRow.vue";

const { t, locale } = useI18n();
const store = useAppStore();

const candidates = ref<ImportCandidate[] | null>(null);
const selected = ref<Set<string>>(new Set());
const groupBy = ref<ImportGroupBy>(DEFAULT_IMPORT_GROUP_BY);
const expandedGroups = ref<Set<string>>(new Set());
const scanning = ref(false);
const importing = ref(false);
const codexCap = ref<number | null>(null);

function keyOf(candidate: ImportCandidate): string {
  return `${candidate.source}:${candidate.externalId}`;
}

const importLabels = computed(() => ({
  noProject: t("settings.importNoProject"),
  sources: {
    "claude-code": t("settings.importSourceClaudeCode"),
    opencode: t("settings.importSourceOpenCode"),
    codex: t("settings.importSourceCodex"),
    pi: t("settings.importSourcePi"),
  },
}));

const groups = computed(() =>
  groupImportCandidates(candidates.value ?? [], groupBy.value, importLabels.value),
);

const allKeys = computed(() => (candidates.value ?? []).map(keyOf));
const allSelected = computed(
  () => allKeys.value.length > 0 && allKeys.value.every((key) => selected.value.has(key)),
);

/** How many of a group's candidates are currently checked. */
function selectedCount(items: ImportCandidate[]): number {
  return items.filter((candidate) => selected.value.has(keyOf(candidate))).length;
}

/** The group's body element id, so the toggle can point `aria-controls` at it. */
function groupBodyId(index: number): string {
  return `import-group-body-${index}`;
}

function toggleKeys(keys: string[], on: boolean) {
  const next = new Set(selected.value);
  for (const key of keys) {
    if (on) next.add(key);
    else next.delete(key);
  }
  selected.value = next;
}

function toggleGroup(id: string) {
  const next = new Set(expandedGroups.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedGroups.value = next;
}

async function scan() {
  scanning.value = true;
  try {
    const result = await api.scanImportSessions();
    candidates.value = result.sessions;
    codexCap.value = typeof result.truncated?.codex === "number" ? result.truncated.codex : null;
    selected.value = new Set();
    expandedGroups.value = new Set();
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
  } finally {
    scanning.value = false;
  }
}

async function runImport() {
  const list = candidates.value;
  if (!list) return;
  const items = list.filter((candidate) => selected.value.has(keyOf(candidate)));
  if (items.length === 0) return;
  importing.value = true;
  try {
    const result = await api.runImportSessions(items);
    await store.appState?.refreshSessions({ revealImportedProjects: true });
    store.appState?.showToast(
      t("settings.importResult", {
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
      }),
      { variant: result.failed > 0 ? "error" : "success" },
    );
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
  } finally {
    importing.value = false;
  }
}

function onGroupByChange(id: string) {
  groupBy.value = id as ImportGroupBy;
  expandedGroups.value = new Set();
}
</script>

<template>
  <SettingsCard :title="t('settings.importTitle')">
    <SettingsRow :title="t('settings.importScan')">
      <Button variant="secondary" :disabled="scanning" @click="void scan()">
        {{ scanning ? t("settings.importScanning") : t("settings.importScan") }}
      </Button>
    </SettingsRow>
  </SettingsCard>

  <SettingsCard v-if="candidates !== null">
    <div v-if="candidates.length === 0" class="settings-empty">
      {{ t("settings.importNone") }}
    </div>
    <template v-else>
      <div class="import-toolbar">
        <label class="import-select-all">
          <input
            type="checkbox"
            :aria-label="t('settings.importSelectAll')"
            :checked="allSelected"
            @change="toggleKeys(allKeys, ($event.target as HTMLInputElement).checked)"
          />
          <span>
            {{ t("settings.importFound", { count: candidates.length }) }}
            {{
              selected.size > 0
                ? ` · ${t("settings.importSelectedCount", { count: selected.size })}`
                : ""
            }}
          </span>
        </label>
        <div class="import-toolbar-actions">
          <label class="import-group-by">
            <span>{{ t("settings.importGroupBy") }}</span>
            <SettingsMenuSelect
              class="import-group-select"
              :label="t('settings.importGroupBy')"
              :value="groupBy"
              :options="[
                { id: 'source', label: t('settings.importGroupBySource') },
                { id: 'path', label: t('settings.importGroupByPath') },
              ]"
              @change="onGroupByChange"
            />
          </label>
          <HelpIcon
            v-if="codexCap != null"
            :label="t('settings.importCodexCapped', { limit: codexCap })"
          />
          <Button
            variant="primary"
            :disabled="importing || selected.size === 0"
            @click="void runImport()"
          >
            {{
              importing
                ? t("settings.importing")
                : t("settings.importSelected", { count: selected.size })
            }}
          </Button>
        </div>
      </div>
      <div class="import-groups">
        <div
          v-for="(group, groupIndex) in groups"
          :key="group.id"
          class="import-group"
        >
          <div class="import-group-header">
            <input
              type="checkbox"
              :aria-label="
                t('settings.importSelectGroup', { name: group.name })
              "
              :checked="selectedCount(group.items) === group.items.length"
              :indeterminate="
                selectedCount(group.items) > 0 &&
                selectedCount(group.items) < group.items.length
              "
              @change="
                toggleKeys(
                  group.items.map(keyOf),
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            <button
              type="button"
              class="import-group-toggle"
              :aria-controls="groupBodyId(groupIndex)"
              :aria-expanded="expandedGroups.has(group.id)"
              @click="toggleGroup(group.id)"
            >
              <span
                class="import-group-chevron"
                :class="{ collapsed: !expandedGroups.has(group.id) }"
                aria-hidden="true"
              >
                <IconChevronLeft :size="13" />
              </span>
              <span class="import-group-name">{{ group.name }}</span>
              <span v-if="group.projectPath" class="import-group-path">
                {{ group.projectPath }}
              </span>
              <span class="import-group-count">
                {{ t("settings.importSessionCount", { count: group.items.length }) }}
              </span>
            </button>
          </div>
          <div
            v-if="expandedGroups.has(group.id)"
            :id="groupBodyId(groupIndex)"
            class="import-group-body"
          >
            <label
              v-for="candidate in group.items"
              :key="keyOf(candidate)"
              class="import-row"
            >
              <input
                type="checkbox"
                :checked="selected.has(keyOf(candidate))"
                @change="
                  toggleKeys(
                    [keyOf(candidate)],
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />
              <span class="import-row-main">
                <span class="import-row-title">{{ candidate.title }}</span>
                <span class="import-row-meta">
                  {{
                    candidate.messageCount === null
                      ? t("settings.importMessagesUnknown")
                      : t("settings.importMessages", {
                          count: candidate.messageCount,
                        })
                  }}
                  {{ " · " }}
                  {{ formatImportDate(candidate.updatedAt, locale) }}
                </span>
              </span>
              <Badge tone="neutral">{{ importLabels.sources[candidate.source] }}</Badge>
            </label>
          </div>
        </div>
      </div>
    </template>
  </SettingsCard>
</template>
