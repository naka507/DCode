<script setup lang="ts">
/**
 * Network proxy settings (Settings → General).
 *
 * The draft URL/bypass commit on
 * blur; an invalid URL is reported without persisting, and a refused write
 * shows the row-level save error.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  DEFAULT_NETWORK_PROXY_BYPASS,
  parseProxyUrl,
  validateNetworkProxy,
  type AppSettings,
  type NetworkProxyMode,
  type NetworkProxySettings,
} from "@dcode/shared";
import { api } from "../../lib/api";
import Button from "../ui/Button.vue";
import Input from "../ui/Input.vue";
import SettingsRow from "../../features/settings/primitives/SettingsRow.vue";

const props = defineProps<{
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}>();

const { t } = useI18n();

const MODES: NetworkProxyMode[] = ["system", "direct", "custom"];

/** The i18n key for a mode segment; the label is title-cased mode id. */
function modeLabelKey(mode: NetworkProxyMode): string {
  return `settings.proxy${mode[0]!.toUpperCase()}${mode.slice(1)}`;
}

const saved = computed<NetworkProxySettings>(
  () => props.settings.networkProxy ?? { mode: "system" },
);

const urlDraft = ref(saved.value.url ?? "");
const bypassDraft = ref(saved.value.bypass ?? DEFAULT_NETWORK_PROXY_BYPASS);
const urlError = ref(false);
const saveError = ref(false);
const testState = ref<"idle" | "busy" | "ok" | "fail">("idle");
const testMessage = ref("");

watch(
  () => [saved.value.url, saved.value.bypass] as const,
  () => {
    urlDraft.value = saved.value.url ?? "";
    bypassDraft.value = saved.value.bypass ?? DEFAULT_NETWORK_PROXY_BYPASS;
    urlError.value = false;
  },
);

async function persist(next: NetworkProxySettings) {
  const validated = validateNetworkProxy(next);
  if (!validated.ok) {
    urlError.value = true;
    return;
  }
  urlError.value = false;
  saveError.value = false;
  try {
    await props.saveSettings({ networkProxy: validated.value });
  } catch {
    saveError.value = true;
  }
}

function chooseMode(mode: NetworkProxyMode) {
  if (mode === saved.value.mode) return;
  testState.value = "idle";
  if (mode !== "custom") {
    void persist({ mode });
    return;
  }
  const parsed = parseProxyUrl(urlDraft.value);
  const url = parsed.ok ? parsed.value.href : "socks5://127.0.0.1:1080";
  if (!parsed.ok) urlDraft.value = url;
  void persist({
    mode: "custom",
    url,
    bypass: bypassDraft.value.trim() || undefined,
  });
}

function commitUrl() {
  if (saved.value.mode !== "custom") return;
  const parsed = parseProxyUrl(urlDraft.value);
  if (!parsed.ok) {
    urlError.value = true;
    return;
  }
  if (parsed.value.href === saved.value.url) {
    urlError.value = false;
    return;
  }
  void persist({
    mode: "custom",
    url: parsed.value.href,
    bypass: bypassDraft.value.trim() || undefined,
  });
}

function commitBypass() {
  if (saved.value.mode !== "custom") return;
  const next = bypassDraft.value.trim() || DEFAULT_NETWORK_PROXY_BYPASS;
  bypassDraft.value = next;
  if (next === (saved.value.bypass ?? DEFAULT_NETWORK_PROXY_BYPASS)) return;
  if (!saved.value.url) return;
  void persist({ mode: "custom", url: saved.value.url, bypass: next });
}

async function runTest() {
  testState.value = "busy";
  testMessage.value = "";
  const payload: NetworkProxySettings =
    saved.value.mode === "custom"
      ? {
          mode: "custom",
          url: urlDraft.value.trim() || saved.value.url,
          bypass: bypassDraft.value.trim() || undefined,
        }
      : { mode: saved.value.mode };
  try {
    const result = await api.testNetworkProxy(payload);
    if (result.ok) {
      testState.value = "ok";
      testMessage.value = t("settings.proxyTestOk");
    } else {
      testState.value = "fail";
      testMessage.value = t("settings.proxyTestFail", {
        message: result.error ?? "",
      });
    }
  } catch (error) {
    testState.value = "fail";
    testMessage.value = t("settings.proxyTestFail", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function onEnterBlur(event: KeyboardEvent) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.blur();
}
</script>

<template>
  <section class="settings-card-block">
    <h3 class="settings-card-heading">{{ t("settings.network") }}</h3>
    <div class="settings-panel">
      <SettingsRow
        :title="t('settings.proxy')"
        :description="t('settings.proxyDesc')"
      >
        <div
          class="settings-segment"
          role="radiogroup"
          :aria-label="t('settings.proxy')"
        >
          <button
            v-for="mode in MODES"
            :key="mode"
            type="button"
            role="radio"
            class="settings-segment-item"
            :class="{ active: saved.mode === mode }"
            :aria-checked="saved.mode === mode"
            @click="chooseMode(mode)"
          >
            {{ t(modeLabelKey(mode)) }}
          </button>
        </div>
      </SettingsRow>

      <template v-if="saved.mode === 'custom'">
        <SettingsRow :title="t('settings.proxyUrl')">
          <div class="settings-proxy-control">
            <Input
              v-model="urlDraft"
              :placeholder="t('settings.proxyUrlPlaceholder')"
              :aria-label="t('settings.proxyUrl')"
              :aria-invalid="urlError"
              @input="urlError = false; testState = 'idle'"
              @blur="commitUrl"
              @keydown="onEnterBlur"
            />
            <span
              v-if="urlError"
              class="settings-command-shell-state error"
              role="status"
            >
              {{ t("settings.proxyInvalid") }}
            </span>
          </div>
        </SettingsRow>
        <SettingsRow
          :title="t('settings.proxyBypass')"
          :description="t('settings.proxyBypassDesc')"
        >
          <Input
            v-model="bypassDraft"
            :aria-label="t('settings.proxyBypass')"
            @blur="commitBypass"
            @keydown="onEnterBlur"
          />
        </SettingsRow>
        <SettingsRow :title="t('settings.proxyTest')">
          <div class="settings-proxy-control">
            <Button
              variant="secondary"
              :disabled="testState === 'busy'"
              @click="void runTest()"
            >
              {{
                testState === "busy"
                  ? t("settings.proxyTesting")
                  : t("settings.proxyTest")
              }}
            </Button>
            <span
              v-if="testState === 'ok' || testState === 'fail'"
              class="settings-command-shell-state"
              :class="{ error: testState === 'fail' }"
              role="status"
            >
              {{ testMessage }}
            </span>
          </div>
        </SettingsRow>
      </template>

      <span
        v-if="saveError"
        class="settings-command-shell-state error"
        role="status"
      >
        {{ t("settings.proxySaveError") }}
      </span>
    </div>
  </section>
</template>
