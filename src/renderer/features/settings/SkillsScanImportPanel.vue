<script setup lang="ts">
/**
 * Scan skills from other agent tools on this machine (Settings → Import).
 *
 * Rows group by source (no
 * group-by control), each row is a candidate whose shape decides the badge,
 * and the import mode chooses whether files are copied or linked.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  api,
  type ExternalSkillCandidate,
  type ExternalSkillImportItem,
  type ExternalSkillScanResult,
} from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { SKILL_SOURCE_KEY, groupBySource } from "./agent-sections";
import Badge from "../../components/ui/Badge.vue";
import Button from "../../components/ui/Button.vue";
import SettingsMenuSelect from "../../components/settings/SettingsMenuSelect.vue";
import SettingsCard from "./primitives/SettingsCard.vue";
import SettingsRow from "./primitives/SettingsRow.vue";

const { t } = useI18n();
const store = useAppStore();

const result = ref<ExternalSkillScanResult | null>(null);
const selected = ref<Set<string>>(new Set());
const mode = ref<"copy" | "link">("copy");
const scanning = ref(false);
const importing = ref(false);

function keyOf(candidate: ExternalSkillCandidate): string {
  return `${candidate.source}:${candidate.sourcePath}`;
}

const groups = computed(() => groupBySource(result.value?.candidates ?? []));
const allKeys = computed(() => (result.value?.candidates ?? []).map(keyOf));
const allSelected = computed(
  () => allKeys.value.length > 0 && allKeys.value.every((key) => selected.value.has(key)),
);

/** The i18n key for a group id; an unknown kind falls back to the Pi label. */
function sourceLabelKey(id: string): string {
  return SKILL_SOURCE_KEY[id as keyof typeof SKILL_SOURCE_KEY] ?? "settings.importSourcePi";
}

function toggle(key: string, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(key);
  else next.delete(key);
  selected.value = next;
}

function selectAll(on: boolean) {
  selected.value = on ? new Set(allKeys.value) : new Set();
}

function onModeChange(id: string) {
  mode.value = id as "copy" | "link";
}

async function scan() {
  scanning.value = true;
  try {
    const next = await api.scanExternalSkills();
    result.value = next;
    selected.value = new Set();
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
  const current = result.value;
  if (!current) return;
  const items: ExternalSkillImportItem[] = current.candidates
    .filter((candidate) => selected.value.has(keyOf(candidate)))
    .map((candidate) => ({
      source: candidate.source,
      sourcePath: candidate.sourcePath,
      shape: candidate.shape,
      rootDir: candidate.rootDir,
      id: candidate.id,
      name: candidate.name,
      description: candidate.description,
    }));
  if (items.length === 0) return;
  importing.value = true;
  try {
    const res = await api.runExternalSkillsImport({
      level: "global",
      mode: mode.value,
      items,
    });
    store.appState?.showToast(
      t("settings.importAgentScanResult", {
        imported: res.imported.length,
        skipped: res.skipped.length,
        failed: res.failed.length,
      }),
      { variant: res.failed.length > 0 ? "error" : "success" },
    );
    // Refresh scan so already-imported rows disappear next round.
    await scan();
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
  <SettingsCard :title="t('settings.importAgentSkillsTitle')">
    <div class="settings-description">
      {{ t("settings.importAgentSkillsDesc") }}
    </div>
    <SettingsRow :title="t('settings.importScan')">
      <Button variant="secondary" :disabled="scanning" @click="void scan()">
        {{ scanning ? t("settings.importScanning") : t("settings.importScan") }}
      </Button>
    </SettingsRow>
    <SettingsRow
      :title="t('settings.importAgentScanMode')"
      :description="t('settings.importAgentScanModeHint')"
    >
      <SettingsMenuSelect
        :label="t('settings.importAgentScanMode')"
        :value="mode"
        :options="[
          { id: 'copy', label: t('settings.importAgentScanModeCopy') },
          { id: 'link', label: t('settings.importAgentScanModeLink') },
        ]"
        @change="onModeChange"
      />
    </SettingsRow>
  </SettingsCard>

  <SettingsCard v-if="result !== null">
    <div v-if="result.candidates.length === 0" class="settings-empty">
      {{ t("settings.importAgentScanNone") }}
    </div>
    <template v-else>
      <div class="import-toolbar">
        <label class="import-select-all">
          <input
            type="checkbox"
            :checked="allSelected"
            :aria-label="t('settings.importSelectAll')"
            @change="selectAll(($event.target as HTMLInputElement).checked)"
          />
          <span>
            {{
              t("settings.importAgentScanFoundSkills", {
                count: result.candidates.length,
              })
            }}
            {{
              selected.size > 0
                ? ` · ${t("settings.importSelectedCount", { count: selected.size })}`
                : ""
            }}
          </span>
        </label>
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
      <div class="import-groups">
        <div v-for="group in groups" :key="group.id" class="import-group">
          <div class="import-group-header">
            <span class="import-group-title">{{ t(sourceLabelKey(group.id)) }}</span>
            <Badge tone="neutral">{{ group.items.length }}</Badge>
          </div>
          <div class="import-group-body">
            <label
              v-for="candidate in group.items"
              :key="keyOf(candidate)"
              class="import-row"
            >
              <input
                type="checkbox"
                :checked="selected.has(keyOf(candidate))"
                @change="
                  toggle(keyOf(candidate), ($event.target as HTMLInputElement).checked)
                "
              />
              <span class="import-row-main">
                <span class="import-row-title">{{ candidate.name || candidate.id }}</span>
                <span class="import-row-meta">
                  {{ candidate.description || candidate.sourcePath }}
                </span>
              </span>
              <Badge :tone="candidate.shape === 'dir' ? 'success' : 'neutral'">
                {{
                  candidate.shape === "dir"
                    ? t("settings.importAgentScanShapeDir")
                    : t("settings.importAgentScanShapeFile")
                }}
              </Badge>
            </label>
          </div>
        </div>
      </div>
    </template>
  </SettingsCard>
</template>
