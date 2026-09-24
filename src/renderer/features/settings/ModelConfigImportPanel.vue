<script setup lang="ts">
/**
 * Import model configs (providers) from other agent tools (Settings → Import).
 *
 * Groups are always by source —
 * unlike the session import there is no per-candidate date and no group-by
 * control — and each row says whether the imported provider carries a key.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  api,
  type ModelConfigImportCandidate,
} from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { hostOf } from "./agent-sections";
import { IconChevronLeft } from "../../lib/icons";
import Badge from "../../components/ui/Badge.vue";
import Button from "../../components/ui/Button.vue";
import SettingsCard from "./primitives/SettingsCard.vue";
import SettingsRow from "./primitives/SettingsRow.vue";

const { t } = useI18n();
const store = useAppStore();

const candidates = ref<ModelConfigImportCandidate[] | null>(null);
const selected = ref<Set<string>>(new Set());
const expandedGroups = ref<Set<string>>(new Set());
const scanning = ref(false);
const importing = ref(false);

function keyOf(candidate: ModelConfigImportCandidate): string {
  return `${candidate.source}:${candidate.externalId}`;
}

const sourceLabels = computed<Record<string, string>>(() => ({
  "claude-code": t("settings.importSourceClaudeCode"),
  opencode: t("settings.importSourceOpenCode"),
  codex: t("settings.importSourceCodex"),
  pi: t("settings.importSourcePi"),
  "cc-switch": t("settings.importSourceCcSwitch"),
}));

const groups = computed(() => {
  const list = candidates.value;
  if (!list) return [];
  const grouped = new Map<string, ModelConfigImportCandidate[]>();
  for (const candidate of list) {
    const items = grouped.get(candidate.source) ?? [];
    items.push(candidate);
    grouped.set(candidate.source, items);
  }
  return [...grouped.entries()].map(([source, items]) => ({
    id: source,
    name: sourceLabels.value[source] ?? source,
    items,
  }));
});

const allKeys = computed(() => (candidates.value ?? []).map(keyOf));
const allSelected = computed(
  () => allKeys.value.length > 0 && allKeys.value.every((key) => selected.value.has(key)),
);

/** How many of a group's candidates are currently checked. */
function selectedCount(items: ModelConfigImportCandidate[]): number {
  return items.filter((candidate) => selected.value.has(keyOf(candidate))).length;
}

/** The group's body element id, so the toggle can point `aria-controls` at it. */
function groupBodyId(index: number): string {
  return `import-model-group-body-${index}`;
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
    const result = await api.scanImportModelConfigs();
    candidates.value = result.providers;
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
    const result = await api.runImportModelConfigs(items);
    await store.appState?.refreshProviders();
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
</script>

<template>
  <SettingsCard :title="t('settings.importModelsTitle')">
    <SettingsRow
      :title="t('settings.importScan')"
      :description="t('settings.importModelsScanDesc')"
    >
      <Button variant="secondary" :disabled="scanning" @click="void scan()">
        {{ scanning ? t("settings.importScanning") : t("settings.importScan") }}
      </Button>
    </SettingsRow>
  </SettingsCard>

  <SettingsCard v-if="candidates !== null">
    <div v-if="candidates.length === 0" class="settings-empty">
      {{ t("settings.importModelsNone") }}
    </div>
    <template v-else>
      <div class="import-toolbar">
        <label class="import-select-all">
          <input
            type="checkbox"
            :aria-label="t('settings.importModelsSelectAll')"
            :checked="allSelected"
            @change="toggleKeys(allKeys, ($event.target as HTMLInputElement).checked)"
          />
          <span>
            {{ t("settings.importModelsFound", { count: candidates.length }) }}
            {{
              selected.size > 0
                ? ` · ${t("settings.importSelectedCount", { count: selected.size })}`
                : ""
            }}
          </span>
        </label>
        <div class="import-toolbar-actions">
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
                t('settings.importModelsSelectGroup', { name: group.name })
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
              <span class="import-group-count">
                {{ t("settings.importModelsFound", { count: group.items.length }) }}
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
                <span class="import-row-title">{{ candidate.name }}</span>
                <span class="import-row-meta">
                  {{ t("settings.importModelsCount", { count: candidate.modelIds.length }) }}
                  {{ hostOf(candidate.baseUrl) ? ` · ${hostOf(candidate.baseUrl)}` : "" }}
                </span>
              </span>
              <Badge :tone="candidate.hasSecret ? 'success' : 'warning'">
                {{
                  candidate.hasSecret
                    ? t("settings.importModelsHasKey")
                    : t("settings.importModelsNoKey")
                }}
              </Badge>
            </label>
          </div>
        </div>
      </div>
    </template>
  </SettingsCard>
</template>
