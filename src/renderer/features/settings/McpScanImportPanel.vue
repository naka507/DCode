<script setup lang="ts">
/**
 * Scan MCP servers from other agent tools on this machine (Settings → Import).
 *
 * Rows group by source; each row's
 * badge says whether the server speaks HTTP or stdio.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  api,
  type ExternalMcpCandidate,
  type ExternalMcpImportItem,
  type ExternalMcpScanResult,
} from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { MCP_SOURCE_KEY, groupBySource } from "./agent-sections";
import Badge from "../../components/ui/Badge.vue";
import Button from "../../components/ui/Button.vue";
import SettingsCard from "./primitives/SettingsCard.vue";
import SettingsRow from "./primitives/SettingsRow.vue";

const { t } = useI18n();
const store = useAppStore();

const result = ref<ExternalMcpScanResult | null>(null);
const selected = ref<Set<string>>(new Set());
const scanning = ref(false);
const importing = ref(false);

function keyOf(candidate: ExternalMcpCandidate): string {
  return `${candidate.source}:${candidate.id}`;
}

const groups = computed(() => groupBySource(result.value?.candidates ?? []));
const allKeys = computed(() => (result.value?.candidates ?? []).map(keyOf));
const allSelected = computed(
  () => allKeys.value.length > 0 && allKeys.value.every((key) => selected.value.has(key)),
);

/** The i18n key for a group id; an unknown kind falls back to the Pi label. */
function sourceLabelKey(id: string): string {
  return MCP_SOURCE_KEY[id as keyof typeof MCP_SOURCE_KEY] ?? "settings.importSourcePi";
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

async function scan() {
  scanning.value = true;
  try {
    const next = await api.scanExternalMcp();
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
  const items: ExternalMcpImportItem[] = current.candidates
    .filter((candidate) => selected.value.has(keyOf(candidate)))
    .map((candidate) => ({
      source: candidate.source,
      sourcePath: candidate.sourcePath,
      id: candidate.id,
      rawKey: candidate.rawKey,
      label: candidate.label,
      description: candidate.description,
      transport: candidate.transport,
      command: candidate.command,
      args: candidate.args,
      env: candidate.env,
      url: candidate.url,
      headers: candidate.headers,
      disabled: candidate.disabled,
    }));
  if (items.length === 0) return;
  importing.value = true;
  try {
    const res = await api.runExternalMcpImport({ items });
    store.appState?.showToast(
      t("settings.importAgentScanResult", {
        imported: res.imported.length,
        skipped: res.skipped.length,
        failed: res.failed.length,
      }),
      { variant: res.failed.length > 0 ? "error" : "success" },
    );
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
  <SettingsCard :title="t('settings.importAgentMcpTitle')">
    <div class="settings-description">
      {{ t("settings.importAgentMcpDesc") }}
    </div>
    <SettingsRow :title="t('settings.importScan')">
      <Button variant="secondary" :disabled="scanning" @click="void scan()">
        {{ scanning ? t("settings.importScanning") : t("settings.importScan") }}
      </Button>
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
              t("settings.importAgentScanFoundMcp", {
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
                <span class="import-row-title">
                  {{ candidate.label || candidate.id }}
                </span>
                <span class="import-row-meta">
                  {{
                    candidate.description ||
                    candidate.command ||
                    candidate.url ||
                    candidate.sourcePath
                  }}
                </span>
              </span>
              <Badge :tone="candidate.transport === 'http' ? 'warning' : 'neutral'">
                {{
                  candidate.transport === "http"
                    ? t("settings.importAgentScanTransportHttp")
                    : t("settings.importAgentScanTransportStdio")
                }}
              </Badge>
            </label>
          </div>
        </div>
      </div>
    </template>
  </SettingsCard>
</template>
