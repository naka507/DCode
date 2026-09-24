<script setup lang="ts">
/**
 * One form to add or edit an AI service.
 *
 * Named services: pick a vendor and paste a key. Custom: name, URL, key and
 * API format on the common path. Models come from the service endpoint.
 *
 * The `ProviderSetupDialog` component.
 *
 * Deliberate choices:
 *  - `portalOverlay(node)` → `<Teleport :to="overlayRoot()">`, the
 *    viewport-fixed host the `.overlay` dialog family uses (`ui-kit.css` sets
 *    `pointer-events: none` on the host and re-enables them for a direct
 *    `.overlay` child).
 *  - `onClose` / `onSaved` are the `close` / `saved` emits. They were declared
 *    as callback props before; every other dialog in this tree announces
 *    its outcome instead of holding a function, and the caller is the one that
 *    owns what happens next.
 *  - The Escape listener is installed once and reads the live `saving` ref, the
 *    shape `SkillEditorSheet.vue` uses, rather than re-binding on
 *    `[advancedOpen, onClose, saving]`.
 *  - The two `useState` initializers that read props (`service`, `name`,
 *    `baseUrl`, `apiStyle`, `headerPairs`, `models`) run once at setup, which is
 *    what a lazy initializer does. The dialog is mounted per provider row,
 *    so nothing re-seeds them.
 *  - `useProviderModels(active, form, provider)` becomes the single `params`
 *    getter `useProviderModels` takes in this tree; `discoveryActive`,
 *    `requestBaseUrl` and `headers` are computeds so the debounce sees the
 *    current values, which is what a per-render hook body did.
 *  - `useModelSelection(discovery, models, setModels)` likewise takes getters:
 *    `models` is read through a getter and written through the setter's updater
 *    form, matching the composable's contract in `model-selection-panes.ts`.
 *  - `ref={apiKeyRef}` / `ref={nameRef}` are the element refs the focus helper
 *    reads; `autoFocus` stays an attribute on the named-path key field because
 *    that field is present from the first paint (no `v-if` gate to race).
 *  - `` `provider-setup-field-row provider-setup-service-row ${named ? "is-named" : "is-single"}` ``
 *    becomes a static `class` plus an object `:class`, so the class contract
 *    reads literal names.
 *
 * `provider-setup-overlay`, `provider-setup-service`, `is-named` and
 * `is-custom` are literal classes in the markup that neither
 * stylesheet ever defined; they are allowlisted for this file in
 * `tests/helpers/class-contract.mjs`. (`settings-hint` was a fifth until the
 * copy-provider sentence moved onto the title's help icon.)
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  NAMED_ENDPOINT_PRESETS,
  OPENCODE_GO_API_STYLE,
  normalizeApiStyle,
  type CatalogApiStyle,
  type ModelBinding,
  type ProviderPublic,
} from "@dcode/shared";
import { api } from "../../lib/api";
import { overlayRoot } from "../../lib/overlay-root";
import {
  pairsToRecord,
  recordToPairs,
  type KeyValuePair,
} from "../extensions/key-value-rows";
import Button from "../ui/Button.vue";
import Field from "../ui/Field.vue";
import HelpIcon from "../ui/HelpIcon.vue";
import Input from "../ui/Input.vue";
import ProviderHeadersEditor from "./ProviderHeadersEditor.vue";
import SettingsMenuSelect from "./SettingsMenuSelect.vue";
import { useProviderModels } from "./useProviderModels";
import ModelSelectionPanes from "./ModelSelectionPanes.vue";
import { useModelSelection } from "./model-selection-panes";
import { CUSTOM_SERVICE } from "./ServicePicker.vue";
import ServicePicker from "./ServicePicker.vue";
import type { ProviderCopyDraft } from "./provider-copy";
import {
  CUSTOM_PROVIDER_API_STYLES,
  isAccountOnlyApiStyle,
  needsCustomApiStyleChoice,
  providerSetupPreset,
} from "./provider-api-style";

const API_STYLE_LABEL_KEYS: Record<CatalogApiStyle, string> = {
  chat_completions: "settings.apiStyleChatCompletions",
  responses: "settings.apiStyleResponses",
  anthropic_messages: "settings.apiStyleAnthropic",
  google_generative_ai: "settings.apiStyleGoogle",
  openai_codex_responses: "settings.apiStyleCodexResponses",
  pi_messages: "settings.apiStylePiMessages",
  opencode_go: "settings.apiStyleOpenCodeGo",
};

type BaseUrlIssue = "invalid";

function endpointPathSuffixes(apiStyle: CatalogApiStyle): string[] {
  switch (apiStyle) {
    case "anthropic_messages":
    case "pi_messages":
      return ["/messages", "/models"];
    case "chat_completions":
      return ["/chat/completions", "/models"];
    case "responses":
    case "openai_codex_responses":
    case "opencode_go":
      return ["/responses", "/models"];
    case "google_generative_ai":
      return ["/models"];
    default:
      return ["/chat/completions", "/models"];
  }
}

function getBaseUrlIssue(value: string): BaseUrlIssue | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return "invalid";
    }
    return null;
  } catch {
    return "invalid";
  }
}

/** Keep pasted operation URLs usable by storing the service root instead. */
function normalizeBaseUrlInput(value: string, apiStyle: CatalogApiStyle): string {
  const trimmed = value.trim();
  if (!trimmed || getBaseUrlIssue(trimmed)) return trimmed;

  let normalized = trimmed.replace(/\/+$/, "");
  const suffixes = endpointPathSuffixes(apiStyle).sort(
    (left, right) => right.length - left.length,
  );
  for (const suffix of suffixes) {
    if (normalized.toLowerCase().endsWith(suffix)) {
      normalized = normalized.slice(0, -suffix.length).replace(/\/+$/, "");
      break;
    }
  }
  return normalized || trimmed;
}

function serviceIdFor(provider?: ProviderPublic | null): string {
  if (!provider) return "";
  return providerSetupPreset(provider)?.id ?? CUSTOM_SERVICE;
}

function initialName(provider?: ProviderPublic | null): string {
  return providerSetupPreset(provider)?.name ?? provider?.name ?? "";
}

function initialBaseUrl(provider?: ProviderPublic | null): string {
  return providerSetupPreset(provider)?.baseUrl ?? provider?.baseUrl ?? "";
}

function endpointHost(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url;
  }
}

const props = withDefaults(
  defineProps<{
    provider?: ProviderPublic | null;
    initialDraft?: ProviderCopyDraft | null;
  }>(),
  { provider: null, initialDraft: null },
);

const emit = defineEmits<{
  close: [];
  saved: [provider: ProviderPublic, models: ModelBinding[]];
}>();

const { t } = useI18n();

const editing = computed(() => !!props.provider);
const apiKeyRef = ref<HTMLInputElement | null>(null);
const nameRef = ref<HTMLInputElement | null>(null);

/* See note 4: each lazy initializer runs once, at setup. */
const service = ref(
  props.initialDraft
    ? props.initialDraft.apiStyle === OPENCODE_GO_API_STYLE
      ? (NAMED_ENDPOINT_PRESETS.find(
          (preset) => preset.apiStyle === OPENCODE_GO_API_STYLE,
        )?.id ?? CUSTOM_SERVICE)
      : CUSTOM_SERVICE
    : serviceIdFor(props.provider),
);
const name = ref(props.initialDraft?.name ?? initialName(props.provider));
const baseUrl = ref(props.initialDraft?.baseUrl ?? initialBaseUrl(props.provider));
const apiKey = ref("");
const apiStyle = ref<CatalogApiStyle>(
  props.initialDraft?.apiStyle ?? normalizeApiStyle(props.provider?.apiStyle),
);
const headerPairs = ref<KeyValuePair[]>(recordToPairs(props.provider?.headers));
const advancedOpen = ref(false);
const models = ref<ModelBinding[]>(
  props.initialDraft?.models ?? props.provider?.models ?? [],
);
const saving = ref(false);
const testing = ref(false);
const error = ref("");
const testResult = ref("");
const baseUrlTouched = ref(false);

const namedPreset = computed(() =>
  NAMED_ENDPOINT_PRESETS.find((preset) => preset.id === service.value),
);
const named = computed(() => Boolean(namedPreset.value));
const custom = computed(() => service.value === CUSTOM_SERVICE);
const resolvedName = computed(() =>
  namedPreset.value ? name.value.trim() || namedPreset.value.name : name.value,
);
const resolvedBaseUrl = computed(
  () => namedPreset.value?.baseUrl ?? baseUrl.value,
);
const resolvedApiStyle = computed<CatalogApiStyle>(
  () => namedPreset.value?.apiStyle ?? apiStyle.value,
);
const baseUrlIssue = computed(() => getBaseUrlIssue(resolvedBaseUrl.value));
const baseUrlError = computed(() =>
  baseUrlTouched.value && baseUrlIssue.value ? t("settings.baseUrlInvalid") : undefined,
);
const requiresApiStyleChoice = computed(
  () =>
    custom.value &&
    needsCustomApiStyleChoice(apiStyle.value, props.provider?.apiStyle),
);
const accountOnlyApiStyle = computed(() => isAccountOnlyApiStyle(apiStyle.value));
const requestBaseUrl = computed(() =>
  normalizeBaseUrlInput(resolvedBaseUrl.value, resolvedApiStyle.value),
);
// Named add-path waits for a key so picking a vendor does not 401-probe.
// Editing reuses the stored secret. Custom still probes a valid URL alone.
const discoveryActive = computed(
  () =>
    Boolean(service.value) &&
    !requiresApiStyleChoice.value &&
    !baseUrlIssue.value &&
    (custom.value || Boolean(apiKey.value.trim()) || Boolean(props.provider)),
);
const headers = computed(() => pairsToRecord(headerPairs.value));

const discovery = useProviderModels(() => ({
  active: discoveryActive.value,
  baseUrl: requestBaseUrl.value,
  apiKey: apiKey.value,
  apiStyle: resolvedApiStyle.value,
  headers: headers.value,
  providerId: props.provider?.id,
}));

const selection = useModelSelection(
  () => discovery,
  () => models.value,
  (update) => {
    models.value = update(models.value);
  },
);

/*
  Installed once, reading the live `saving` ref: it re-bound on
  `[advancedOpen, onClose, saving]`, but nothing about this handler needs the
  binding to change, and a stale closure over a prop is exactly the bug a
  re-bind was working around.
*/
function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || saving.value) return;
  if (advancedOpen.value) {
    advancedOpen.value = false;
    return;
  }
  emit("close");
}

onMounted(() => window.addEventListener("keydown", onKeyDown));
onUnmounted(() => window.removeEventListener("keydown", onKeyDown));

function focusAfterServiceChange(next: string) {
  window.setTimeout(() => {
    if (next === CUSTOM_SERVICE) nameRef.value?.focus();
    else if (next) apiKeyRef.value?.focus();
  }, 0);
}

function onServiceChange(next: string) {
  const previous = namedPreset.value;
  service.value = next;
  baseUrlTouched.value = false;
  const preset = NAMED_ENDPOINT_PRESETS.find((item) => item.id === next);
  if (!preset) {
    if (next === CUSTOM_SERVICE && apiStyle.value === OPENCODE_GO_API_STYLE) {
      apiStyle.value = "chat_completions";
    }
    focusAfterServiceChange(next);
    return;
  }
  const currentName = name.value.trim();
  if (!currentName || currentName === previous?.name) name.value = preset.name;
  baseUrl.value = preset.baseUrl;
  apiStyle.value = preset.apiStyle;
  focusAfterServiceChange(next);
}

function commitBaseUrl() {
  baseUrlTouched.value = true;
  const normalized = normalizeBaseUrlInput(baseUrl.value, resolvedApiStyle.value);
  if (normalized !== baseUrl.value) baseUrl.value = normalized;
}

async function testConnection() {
  if (!props.provider) return;
  testing.value = true;
  testResult.value = "";
  try {
    const result = (await api.testProvider(props.provider.id)) as {
      ok?: boolean;
      message?: string;
      status?: number;
    };
    testResult.value = result?.ok
      ? t("settings.testOk")
      : result?.message ||
        (result?.status
          ? t("settings.testFailedStatus", { status: result.status })
          : t("settings.testFailed"));
  } catch (cause) {
    testResult.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    testing.value = false;
  }
}

async function save() {
  const providerName = resolvedName.value.trim();
  const providerBaseUrl = normalizeBaseUrlInput(
    resolvedBaseUrl.value,
    resolvedApiStyle.value,
  );
  if (
    requiresApiStyleChoice.value ||
    !providerName ||
    !providerBaseUrl ||
    getBaseUrlIssue(providerBaseUrl) ||
    models.value.length === 0
  ) {
    baseUrlTouched.value = true;
    return;
  }
  const persisted = selection.bindingsToPersist;
  saving.value = true;
  error.value = "";
  try {
    if (props.provider) {
      const result = await api.updateProvider({
        id: props.provider.id,
        name: providerName,
        vendorKey: namedPreset.value?.vendorKey ?? "custom",
        baseUrl: providerBaseUrl,
        defaultModelId: persisted[0]?.id,
        models: persisted,
        apiStyle: resolvedApiStyle.value,
        headers: headers.value,
        ...(apiKey.value ? { secretValue: apiKey.value } : {}),
      });
      emit("saved", result.provider ?? props.provider, persisted);
    } else {
      const result = await api.createProvider({
        name: providerName,
        vendorKey: namedPreset.value?.vendorKey ?? "custom",
        type: "openai_compatible",
        protocol: "openai_compatible",
        baseUrl: providerBaseUrl,
        authKind: "api_key_and_base_url",
        defaultModelId: persisted[0]?.id,
        models: persisted,
        secretValue: apiKey.value || undefined,
        apiStyle: resolvedApiStyle.value,
        headers: headers.value,
      });
      emit("saved", result.provider, persisted);
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving.value = false;
  }
}

const canSave = computed(
  () =>
    !saving.value &&
    !requiresApiStyleChoice.value &&
    !!service.value &&
    !!resolvedName.value.trim() &&
    !!resolvedBaseUrl.value.trim() &&
    !baseUrlIssue.value &&
    models.value.length > 0,
);

const apiStyleOptions = computed(() => [
  ...(accountOnlyApiStyle.value
    ? [
        {
          id: apiStyle.value,
          label: t(API_STYLE_LABEL_KEYS[apiStyle.value]),
          disabled: true,
        },
      ]
    : []),
  ...CUSTOM_PROVIDER_API_STYLES.map((style) => ({
    id: style,
    label: t(API_STYLE_LABEL_KEYS[style]),
  })),
]);
</script>

<template>
  <Teleport :to="overlayRoot()">
    <div
      class="overlay provider-setup-overlay"
      role="presentation"
      @click="saving ? undefined : emit('close')"
    >
      <div
        class="dialog provider-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-setup-title"
        @click="$event.stopPropagation()"
      >
        <div class="provider-setup-head">
          <h3 id="provider-setup-title" class="provider-setup-title">
            {{
              initialDraft
                ? t("settings.copyProviderTitle")
                : editing
                  ? t("settings.editProviderTitle")
                  : t("settings.addProviderTitle")
            }}
            <!-- What a copy does and does not take is the title's own promise. -->
            <HelpIcon
              v-if="initialDraft"
              :label="t('settings.copyProviderHint')"
            />
          </h3>
          <div class="provider-setup-head-actions">
            <Button
              v-if="named || custom"
              variant="ghost"
              size="sm"
              :disabled="saving"
              @click="advancedOpen = true"
            >
              {{ t("settings.advancedSettings") }}
            </Button>
            <Button
              v-if="provider"
              variant="ghost"
              size="sm"
              :disabled="testing || saving"
              @click="void testConnection()"
            >
              {{ testing ? t("settings.testing") : t("settings.testConnection") }}
            </Button>
            <Button variant="ghost" size="sm" :disabled="saving" @click="emit('close')">
              {{ t("settings.cancel") }}
            </Button>
            <Button
              variant="primary"
              size="sm"
              :disabled="!canSave"
              @click="void save()"
            >
              {{ saving ? t("settings.saving") : t("settings.saveProvider") }}
            </Button>
          </div>
        </div>

        <div class="provider-setup-body">
          <div v-if="error" class="provider-setup-error">{{ error }}</div>

          <div class="provider-setup-credentials">
            <div
              class="provider-setup-fields"
              :class="{
                'is-named': named,
                'is-custom': custom,
                'is-empty': !named && !custom,
              }"
            >
              <div
                class="provider-setup-field-row provider-setup-service-row"
                :class="named ? 'is-named' : 'is-single'"
              >
                <div class="provider-setup-service">
                  <Field :label="t('settings.service')">
                    <ServicePicker
                      :value="service"
                      :auto-focus="!named && !custom"
                      :disabled="saving"
                      :on-change="onServiceChange"
                    />
                  </Field>
                </div>

                <Field
                  v-if="named"
                  :label="t('settings.apiKey')"
                  :hint="editing ? t('settings.apiKeyKeepHint') : undefined"
                >
                  <Input
                    ref="apiKeyRef"
                    type="password"
                    :value="apiKey"
                    placeholder="sk-…"
                    class="font-mono text-sm-plus"
                    autocomplete="off"
                    autofocus
                    @input="apiKey = ($event.target as HTMLInputElement).value"
                  />
                </Field>
              </div>

              <div
                v-if="named && resolvedBaseUrl"
                class="provider-setup-host"
                :title="resolvedBaseUrl"
              >
                {{ endpointHost(resolvedBaseUrl) }}
              </div>

              <template v-if="custom">
                <div class="provider-setup-field-row provider-setup-custom-identity-row">
                  <Field :label="t('settings.name')">
                    <Input
                      ref="nameRef"
                      :value="name"
                      autofocus
                      @input="name = ($event.target as HTMLInputElement).value"
                    />
                  </Field>
                  <div class="provider-setup-base-url">
                    <Field :label="t('settings.baseUrl')">
                      <Input
                        :value="baseUrl"
                        type="url"
                        inputmode="url"
                        autocomplete="url"
                        class="font-mono text-sm-plus"
                        placeholder="https://api.example.com/v1"
                        :aria-invalid="Boolean(baseUrlError)"
                        :aria-describedby="
                          baseUrlError ? 'provider-base-url-error' : undefined
                        "
                        @input="
                          baseUrl = ($event.target as HTMLInputElement).value;
                          error = '';
                        "
                        @blur="commitBaseUrl"
                      />
                      <div
                        v-if="baseUrlError"
                        id="provider-base-url-error"
                        class="provider-setup-field-error"
                        role="alert"
                      >
                        {{ baseUrlError }}
                      </div>
                    </Field>
                  </div>
                </div>
                <div class="provider-setup-field-row provider-setup-custom-auth-row">
                  <Field
                    :label="t('settings.apiKey')"
                    :hint="editing ? t('settings.apiKeyKeepHint') : undefined"
                  >
                    <Input
                      ref="apiKeyRef"
                      type="password"
                      :value="apiKey"
                      placeholder="sk-…"
                      class="font-mono text-sm-plus"
                      autocomplete="off"
                      @input="apiKey = ($event.target as HTMLInputElement).value"
                    />
                  </Field>
                  <Field
                    :label="t('settings.apiStyle')"
                    :hint="
                      accountOnlyApiStyle
                        ? t(
                            requiresApiStyleChoice
                              ? 'settings.apiStyleChooseCustom'
                              : 'settings.apiStyleLegacyAccount',
                          )
                        : undefined
                    "
                  >
                    <SettingsMenuSelect
                      full-width
                      :label="t('settings.apiStyle')"
                      :value="apiStyle"
                      :disabled="saving"
                      :options="apiStyleOptions"
                      @change="apiStyle = $event as CatalogApiStyle"
                    />
                  </Field>
                </div>
              </template>
            </div>

            <div v-if="testResult" class="provider-credential-test">
              <span class="provider-credential-test-result">{{ testResult }}</span>
            </div>
          </div>

          <ModelSelectionPanes
            :discovery="discovery"
            :selection="selection"
            :list-title="t('settings.serviceModels')"
            :busy="saving"
            :on-reload="discovery.reload"
            :api-style="resolvedApiStyle"
          />
        </div>
      </div>

      <div
        v-if="advancedOpen && (named || custom)"
        class="overlay provider-advanced-overlay"
        role="presentation"
        @click="
          $event.stopPropagation();
          if ($event.target === $event.currentTarget) advancedOpen = false;
        "
      >
        <div
          class="dialog provider-advanced-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="provider-advanced-title"
          @click="$event.stopPropagation()"
        >
          <div class="provider-advanced-head">
            <h4 id="provider-advanced-title" class="provider-advanced-title">
              {{ t("settings.advancedSettings") }}
            </h4>
            <Button variant="ghost" size="sm" @click="advancedOpen = false">
              {{ t("settings.close") }}
            </Button>
          </div>
          <div class="provider-advanced-body">
            <div class="provider-setup-advanced">
              <Field v-if="named" :label="t('settings.name')">
                <Input
                  :value="name"
                  @input="name = ($event.target as HTMLInputElement).value"
                />
              </Field>
              <ProviderHeadersEditor
                :pairs="headerPairs"
                :on-change="(next) => (headerPairs = next)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
