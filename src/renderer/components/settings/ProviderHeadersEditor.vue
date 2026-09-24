<script setup lang="ts">
/**
 * Outbound HTTP header editor for the provider dialogs.
 *
 * The `ProviderHeadersEditor` component. Header
 * presets, JSON import, and a copy-to-clipboard of the current map, on top of
 * the shared key/value rows.
 *
 * The three pure helpers (`isRecord`, `parseImportedHeaders`,
 * `mergeHeaderPairs`) are not exported either, so they stay local.
 *
 * Deliberate choices:
 *  - `useEffect(() => () => clearTimeout(...), [])` → `onBeforeUnmount`.
 *  - The copy button's class was a template literal
 *    (`` `provider-setup-header-copy${copied ? " is-copied" : ""}` ``); this file
 *    spells the modifier as an object `:class` so the class contract reads a
 *    literal name instead of the glued fragment.
 * - `SettingsMenuSelect` emits `change` (the `onChange` prop), and its
 *    trigger class comes from `class` rather than a `className` prop.
 *  - `pairsToRecord` is imported from the split-out
 *    `../extensions/key-value-rows`, which holds the framework-free half of the
 *    key/value rows.
 */
import { onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { APP_VERSION } from "@dcode/shared";
import {
  pairsToRecord,
  type KeyValuePair,
} from "../extensions/key-value-rows";
import KeyValueRows from "../extensions/KeyValueRows.vue";
import { IconCheck, IconCopy } from "../../lib/icons";
import Button from "../ui/Button.vue";
import SettingsMenuSelect from "./SettingsMenuSelect.vue";

type HeaderPreset = {
  key: string;
  value: string;
};

const HEADER_PRESETS: HeaderPreset[] = [
  { key: "User-Agent", value: `DCode/${APP_VERSION}` },
  { key: "X-Client-Name", value: "DCode" },
  { key: "X-Title", value: "DCode" },
];

const props = defineProps<{
  pairs: KeyValuePair[];
  onChange: (next: KeyValuePair[]) => void;
}>();

const { t } = useI18n();

const fileInputRef = ref<HTMLInputElement | null>(null);
const importError = ref(false);
const copied = ref(false);
let copyTimer: number | undefined;

onBeforeUnmount(() => window.clearTimeout(copyTimer));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseImportedHeaders(value: unknown): KeyValuePair[] {
  const source =
    isRecord(value) && isRecord(value.headers) ? value.headers : value;
  if (!isRecord(source)) throw new Error("invalid headers");

  return Object.entries(source).map(([key, headerValue]) => {
    if (typeof headerValue !== "string") throw new Error("invalid header value");
    return { key, value: headerValue };
  });
}

function mergeHeaderPairs(
  current: KeyValuePair[],
  imported: KeyValuePair[],
): KeyValuePair[] {
  const next = [...current];
  for (const pair of imported) {
    const existing = next.findIndex(
      (item) => item.key.trim().toLowerCase() === pair.key.trim().toLowerCase(),
    );
    if (existing === -1) next.push(pair);
    else if (!next[existing]!.value.trim()) next[existing] = pair;
  }
  return next;
}

function addPreset(key: string) {
  const preset = HEADER_PRESETS.find((item) => item.key === key);
  if (!preset) return;
  const exists = props.pairs.some(
    (item) => item.key.trim().toLowerCase() === preset.key.toLowerCase(),
  );
  if (!exists) props.onChange([...props.pairs, preset]);
}

function copyHeaders() {
  void navigator.clipboard
    .writeText(JSON.stringify(pairsToRecord(props.pairs), null, 2))
    .then(
      () => {
        copied.value = true;
        window.clearTimeout(copyTimer);
        copyTimer = window.setTimeout(() => {
          copied.value = false;
        }, 1500);
      },
      () => undefined,
    );
}

async function importJson(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const imported = parseImportedHeaders(JSON.parse(await file.text()));
    props.onChange(mergeHeaderPairs(props.pairs, imported));
    importError.value = false;
  } catch {
    importError.value = true;
  }
}
</script>

<template>
  <div class="provider-setup-headers">
    <div class="provider-setup-headers-toolbar">
      <div class="provider-setup-headers-label">{{ t("settings.headers") }}</div>
      <div class="provider-setup-headers-actions">
        <SettingsMenuSelect
          class="provider-setup-header-preset"
          :label="t('settings.addCommonHeader')"
          value=""
          @change="addPreset"
          :options="[
            { id: '', label: t('settings.addCommonHeader') },
            ...HEADER_PRESETS.map((preset) => ({
              id: preset.key,
              label: preset.key,
            })),
          ]"
        />
        <Button
          variant="ghost"
          size="sm"
          class="provider-setup-header-import"
          @click="fileInputRef?.click()"
        >
          {{ t("settings.importHeadersJson") }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="provider-setup-header-copy"
          :class="{ 'is-copied': copied }"
          @click="copyHeaders"
          :aria-label="
            copied ? t('settings.headersJsonCopied') : t('settings.copyHeadersJson')
          "
          :title="
            copied ? t('settings.headersJsonCopied') : t('settings.copyHeadersJson')
          "
        >
          <IconCheck v-if="copied" :size="12" />
          <IconCopy v-else :size="12" />
          {{ copied ? t("settings.headersJsonCopied") : t("settings.copyHeadersJson") }}
        </Button>
        <input
          ref="fileInputRef"
          class="provider-setup-header-file"
          type="file"
          accept="application/json,.json"
          :aria-label="t('settings.importHeadersJson')"
          @change="void importJson($event)"
        />
      </div>
    </div>
    <div v-if="importError" class="provider-setup-header-error" role="alert">
      {{ t("settings.headersImportError") }}
    </div>
    <div class="provider-setup-header-list">
      <KeyValueRows
        :pairs="pairs"
        :on-change="onChange"
        :key-placeholder="t('settings.headerName')"
        :value-placeholder="t('settings.headerValue')"
        :add-label="t('settings.addHeader')"
      />
    </div>
  </div>
</template>
