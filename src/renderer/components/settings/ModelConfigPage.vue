<script setup lang="ts">
/**
 * Model configuration tab: default model, configured AI services, OAuth vendor
 * accounts, and the models.dev enrichment snapshot status.
 *
 * The `ModelConfigPage` component. The default
 * picker lists each configured model, while provider rows use `models[0]` as the
 * provider's quick default. Editing the default provider re-syncs
 * `settings.defaultModelId` when that first model changes.
 *
 * Deliberate choices:
 *
 * 1. **Store selectors become `store.appState` reads.** `providers`, `settings`,
 *     `refreshProviders` and `showToast` are destructured out of
 *     `useAppStore`; here they are `computed(() => store.appState?.field)` or
 *     `store.appState?.action()` calls. `getState()` is never called from a
 *     component.
 *  2. **The `if (!settings) return null` early return is a `v-if` on the root.**
 *     A Vue `setup` cannot return early with markup, so every read of
 *     `settings` in this file is optional-chained and the whole panel is gated
 *     on `settings` being present — the same DOM, with no render at all.
 *  3. **The two `useEffect`s are `watch` and `onMounted`.** The delete-confirm
 *     timer re-arms whenever the armed id changes and its returned `clearTimeout`
 *     is the watch's `onCleanup`; the catalog-status read has an empty
 *     dependency array and runs once on mount.
 * 4. **The per-row derivations are one `defaultModelRows` computed.**
 *     `isCurrent`, `startsGroup` and the previous row used to be computed inside
 *     the JSX map callback. A Vue template cannot declare locals per iteration,
 *     so the same values are derived in a `computed` that reads the same refs.
 * 5. **`hostFromBaseUrl` stays a local function.** It is not exported
 *     (the sibling helper in the settings sections is a different `hostOf` that returns
 *     an empty string rather than an em dash), so there is nothing to reuse and
 *     nothing to split out.
 *  6. **`t(key, { defaultValue })` is `t(key)`.**
 *  7. **`AnchoredMenu`'s `trigger(ref)` render prop is its `#trigger` slot**,
 *     and `ProviderSetupDialog`'s `onClose` / `onSaved` callbacks are its
 *     `close` / `saved` emits.
 *
 * `model-default-panel` and `model-default-label` are literal classes in
 * the markup that neither stylesheet defines; they are allowlisted
 * for this file in `tests/helpers/class-contract.mjs`.
 */
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  OAUTH_AUTH_KIND,
  modelIdsMatch,
  type ModelBinding,
  type ProviderPublic,
} from "@dcode/shared";
import { useAppStore } from "../../stores/app-store";
import { api } from "../../lib/api";
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconKey,
  IconPencil,
  IconPlug,
  IconPlus,
  IconServer,
  IconSearch,
  IconTrash,
} from "../../lib/icons";
import { useProviderReorder } from "./useProviderReorder";
import Badge from "../ui/Badge.vue";
import Button from "../ui/Button.vue";
import Field from "../ui/Field.vue";
import Input from "../ui/Input.vue";
import TooltipButton from "../TooltipButton.vue";
import AnchoredMenu from "./AnchoredMenu.vue";
import {
  defaultModelIdOf,
  defaultModelOptions,
  displayedDefaultModelId,
} from "./default-model";
import { copyProviderConfiguration, type ProviderCopyDraft } from "./provider-copy";
import ProviderSetupDialog from "./ProviderSetupDialog.vue";
import VendorAccountsSection from "./VendorAccountsSection.vue";

const DELETE_CONFIRM_MS = 3000;

/* The wire shape of the status channel; derived so the page cannot drift from
   `lib/api.ts`, which owns the IPC contract. */
type CatalogStatus = Awaited<ReturnType<typeof api.modelCatalogStatus>>["status"];

/** Host part of a base URL, or an em dash when nothing is configured. */
function hostFromBaseUrl(baseUrl?: string | null): string {
  if (!baseUrl) return "—";
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").split("/")[0] || baseUrl;
  }
}

/** One row of the default-model menu, with its per-row derivations resolved. */
type DefaultModelRow = {
  key: string;
  provider: ProviderPublic;
  modelId: string;
  /** True for every row but the first, so a group header draws its divider. */
  hasDivider: boolean;
  isCurrent: boolean;
  startsGroup: boolean;
};

const { t } = useI18n();
const store = useAppStore();

const providers = computed(() => store.appState?.providers ?? []);
const settings = computed(() => store.appState?.settings);

// null = closed, "" = add flow, provider id = edit flow.
const copyDraft = ref<ProviderCopyDraft | null>(null);
const setupFor = ref<string | null>(null);
const pickingDefault = ref(false);
const defaultModelQuery = ref("");
const busyId = ref<string | null>(null);
const testingId = ref<string | null>(null);
const catalogStatus = ref<CatalogStatus | null>(null);
/* Two-step delete: the first click arms the row, the second removes it. */
const confirmDeleteId = ref<string | null>(null);
// Inline API-key entry for a plugin-declared row. The plugin owns the
// provider's fields, so the user supplies only the credential it asks for.
const keyFor = ref<string | null>(null);
const keyValue = ref("");
let confirmTimer: number | undefined;

/* See note 3: the returned `clearTimeout` is the watch's cleanup. */
watch(confirmDeleteId, (id, _previous, onCleanup) => {
  if (!id) return;
  confirmTimer = window.setTimeout(() => {
    confirmDeleteId.value = null;
  }, DELETE_CONFIRM_MS);
  onCleanup(() => window.clearTimeout(confirmTimer));
});

/*
  The settings values the provider rows read. Each is a separate computed rather
  than `settings.value.x` in the template because a `v-if` on the root does not
  narrow an optional store read for the generated `v-for` scope; the optional
  chain happens once, here.
*/
const defaultProviderId = computed(() => settings.value?.defaultProviderId);

/* See note 3: an empty dependency list is a single mount run. */
onMounted(() => {
  void (async () => {
    try {
      const result = await api.modelCatalogStatus();
      catalogStatus.value = result.status;
    } catch {
      // The status line simply stays hidden when the catalog cannot report.
      catalogStatus.value = null;
    }
  })();
});

function providerReady(provider: ProviderPublic): boolean {
  return (
    provider.enabled &&
    !!defaultModelIdOf(provider) &&
    (provider.hasSecret || provider.hasOauth || provider.authKind === "none")
  );
}

const aiProviders = computed(() =>
  providers.value.filter((provider) => provider.authKind !== OAUTH_AUTH_KIND),
);

/*
  The controller is created right after `aiProviders`, with the same busy
  expression: any row-level operation in flight blocks a move. The controller is
  destructured the way `ModelSelectionPanes.vue` destructures `useModelReorder`,
  so each ref is a top-level binding and unwraps in the template.
*/
const {
  draggingId: reorderDraggingId,
  disabled: reorderDisabled,
  saving: reorderSaving,
  providers: reorderProviders,
  onRowKeydown,
  onRowDragStart,
  onRowClickCapture,
  onRowPointerDown,
  rowRef: reorderRowRef,
} = useProviderReorder(aiProviders, () =>
  busyId.value !== null || testingId.value !== null || setupFor.value !== null,
);
const readyProviders = computed(() => providers.value.filter(providerReady));
const defaultModelOptionsList = computed(() =>
  defaultModelOptions(readyProviders.value),
);
const visibleDefaultModelOptions = computed(() => {
  const query = defaultModelQuery.value.trim().toLowerCase();
  if (!query) return defaultModelOptionsList.value;
  return defaultModelOptionsList.value.filter(({ provider, modelId }) =>
    `${provider.name} ${modelId}`.toLowerCase().includes(query),
  );
});

const defaultProvider = computed(
  () =>
    providers.value.find(
      (provider) => provider.id === settings.value?.defaultProviderId,
    ) ?? null,
);
const editingProvider = computed(() =>
  setupFor.value
    ? (providers.value.find((provider) => provider.id === setupFor.value) ?? null)
    : null,
);
const defaultProviderReady = computed(
  () => defaultProvider.value !== null && providerReady(defaultProvider.value),
);
const defaultModelDisplay = computed(() =>
  defaultProvider.value
    ? displayedDefaultModelId(
        defaultProvider.value,
        settings.value?.defaultModelId,
      ) || t("settings.noModel")
    : "",
);

/* See note 4: the per-row values a Vue template cannot declare inline. */
const defaultModelRows = computed<DefaultModelRow[]>(() =>
  visibleDefaultModelOptions.value.map(({ provider, modelId }, index) => {
    const previous = visibleDefaultModelOptions.value[index - 1];
    return {
      key: `${provider.id}:${modelId}`,
      provider,
      modelId,
      hasDivider: index > 0,
      isCurrent:
        provider.id === settings.value?.defaultProviderId &&
        modelIdsMatch(settings.value?.defaultModelId ?? "", modelId),
      startsGroup: !previous || previous.provider.id !== provider.id,
    };
  }),
);

async function setDefaultModel(provider: ProviderPublic, modelId: string) {
  const current = settings.value;
  if (!current) return;
  busyId.value = provider.id;
  try {
    await api.setSettings({
      ...current,
      defaultProviderId: provider.id,
      defaultModelId: modelId,
    });
    await store.appState?.refreshProviders();
    store.appState?.showToast(t("settings.defaultUpdated"), { variant: "success" });
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
  } finally {
    busyId.value = null;
    pickingDefault.value = false;
  }
}

/**
 * A saved provider that is also the global default may have changed its first
 * model, which is what `settings.defaultModelId` points at.
 */
async function afterSaved(saved: ProviderPublic, models: ModelBinding[]) {
  const current = settings.value;
  if (!current) return;
  const firstModelId = models[0]?.id;
  try {
    if (copyDraft.value) {
      store.appState?.showToast(t("settings.providerSaved"), { variant: "success" });
    } else if (!editingProvider.value) {
      await api.setSettings({
        ...current,
        defaultProviderId: saved.id,
        defaultModelId: firstModelId ?? "",
      });
      store.appState?.showToast(t("settings.providerSaved"), { variant: "success" });
    } else {
      if (current.defaultProviderId === saved.id && firstModelId) {
        await api.setSettings({ ...current, defaultModelId: firstModelId });
      }
      store.appState?.showToast(t("settings.providerUpdated"), { variant: "success" });
    }
    setupFor.value = null;
    copyDraft.value = null;
    await store.appState?.refreshProviders();
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
  }
}

async function toggleEnabled(provider: ProviderPublic) {
  busyId.value = provider.id;
  try {
    await api.updateProvider({ id: provider.id, enabled: !provider.enabled });
    await store.appState?.refreshProviders();
    store.appState?.showToast(
      t(provider.enabled ? "settings.providerDisabled" : "settings.providerEnabled"),
      { variant: "success" },
    );
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
  } finally {
    busyId.value = null;
  }
}

async function removeProvider(provider: ProviderPublic) {
  confirmDeleteId.value = null;
  busyId.value = provider.id;
  try {
    await api.deleteProvider(provider.id);
    await store.appState?.refreshProviders();
    store.appState?.showToast(t("settings.providerRemoved"), { variant: "success" });
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
  } finally {
    busyId.value = null;
  }
}

async function saveProviderKey(provider: ProviderPublic, value: string) {
  busyId.value = provider.id;
  try {
    await api.setProviderSecret({ id: provider.id, secretValue: value });
    await store.appState?.refreshProviders();
    keyFor.value = null;
    keyValue.value = "";
    store.appState?.showToast(
      t(
        value.trim()
          ? "settings.pluginProviderKeySaved"
          : "settings.pluginProviderKeyRemoved",
      ),
      { variant: "success" },
    );
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
  } finally {
    busyId.value = null;
  }
}

async function testProvider(provider: ProviderPublic) {
  testingId.value = provider.id;
  try {
    const result = (await api.testProvider(provider.id)) as {
      ok?: boolean;
      message?: string;
      status?: number;
    };
    if (result?.ok) {
      store.appState?.showToast(t("settings.testOk"), { variant: "success" });
    } else {
      store.appState?.showToast(
        result?.message ||
          (result?.status
            ? t("settings.testFailedStatus", { status: result.status })
            : t("settings.testFailed")),
        { variant: "error" },
      );
    }
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
  } finally {
    testingId.value = null;
  }
}

const catalogSourceLabel = computed(() =>
  t(
    catalogStatus.value?.source === "bundled"
      ? "settings.catalogSourceBundled"
      : "settings.catalogSourceEmpty",
  ),
);

const catalogStatusLine = computed(() => {
  const status = catalogStatus.value;
  if (!status) return t("settings.catalogStatusUnknown");
  // The bundled snapshot is the only data source and it was never fetched, so
  // the line reports what is loaded instead of a fetch time.
  return t("settings.catalogStatusLine", {
    source: catalogSourceLabel.value,
    models: status.modelCount,
    fetchedAt: t("settings.catalogNeverFetched"),
  });
});

function onDefaultModelTriggerClick() {
  defaultModelQuery.value = "";
  pickingDefault.value = !pickingDefault.value;
}

function onKeyEntryKeydown(event: KeyboardEvent, provider: ProviderPublic) {
  if (event.key === "Escape") keyFor.value = null;
  if (event.key === "Enter") {
    void saveProviderKey(provider, keyValue.value);
  }
}
</script>

<template>
  <div v-if="settings" class="settings-stack model-config-page">
    <section class="settings-card-block">
      <div class="model-config-section-head">
        <h3 class="settings-card-heading">{{ t("settings.defaultsTitle") }}</h3>
      </div>
      <div class="settings-panel model-default-panel">
        <div class="settings-row model-default-row">
          <div class="settings-row-copy model-default-copy">
            <div class="settings-row-title model-default-label">
              {{ t("settings.defaultModel") }}
            </div>
            <div v-if="defaultProviderReady" class="settings-row-detail model-default-value">
              <span class="model-default-provider">{{ defaultProvider?.name }}</span>
              <span class="model-default-sep" aria-hidden="true">·</span>
              <span class="model-default-model font-mono">{{ defaultModelDisplay }}</span>
            </div>
            <div v-else class="settings-row-detail model-default-value">
              <span class="model-default-empty">
                {{
                  readyProviders.length === 0
                    ? t("settings.defaultModelNone")
                    : t("settings.noDefaultProvider")
                }}
              </span>
            </div>
          </div>
          <AnchoredMenu
            class="model-default-anchor"
            :open="pickingDefault"
            menu-class-name="model-default-menu"
            :label="t('settings.changeDefaultModel')"
            align="end"
            @close="pickingDefault = false"
          >
            <template #trigger="{ setAnchor }">
              <Button
                :ref="setAnchor"
                class="settings-text-action model-default-trigger"
                variant="ghost"
                :disabled="readyProviders.length === 0"
                aria-haspopup="listbox"
                :aria-expanded="pickingDefault"
                @click="onDefaultModelTriggerClick"
              >
                {{ t("settings.changeDefaultModel") }}
                <IconChevronDown
                  class="model-default-trigger-chevron"
                  :size="13"
                  aria-hidden="true"
                />
              </Button>
            </template>

            <div class="model-default-search">
              <IconSearch :size="14" aria-hidden="true" />
              <Input
                :value="defaultModelQuery"
                :placeholder="t('settings.defaultModelSearch')"
                :aria-label="t('settings.defaultModelSearch')"
                autofocus
                @input="defaultModelQuery = ($event.target as HTMLInputElement).value"
              />
            </div>
            <div class="model-default-results" role="presentation">
              <div
                v-if="visibleDefaultModelOptions.length === 0"
                class="model-default-no-results"
              >
                {{ t("settings.noModelMatches") }}
              </div>
              <ul class="model-default-list">
                <li v-for="row in defaultModelRows" :key="row.key">
                  <div
                    v-if="row.startsGroup"
                    class="model-default-provider-group"
                    :class="{ 'has-divider': row.hasDivider }"
                  >
                    {{ row.provider.name }}
                  </div>
                  <button
                    type="button"
                    role="option"
                    :aria-selected="row.isCurrent"
                    :aria-label="`${row.provider.name} · ${row.modelId}`"
                    class="model-default-option"
                    :class="{ 'is-current': row.isCurrent }"
                    :disabled="busyId === row.provider.id"
                    @click="void setDefaultModel(row.provider, row.modelId)"
                  >
                    <span class="model-default-option-check" aria-hidden="true">
                      <IconCheck v-if="row.isCurrent" :size="12" />
                    </span>
                    <span class="model-default-option-model font-mono">
                      {{ row.modelId }}
                    </span>
                  </button>
                </li>
              </ul>
            </div>
          </AnchoredMenu>
        </div>
      </div>
    </section>

    <section class="settings-card-block">
      <div class="model-config-section-head">
        <div class="settings-card-heading-line">
          <h3 class="settings-card-heading">{{ t("settings.providers") }}</h3>
          <span v-if="aiProviders.length > 0" class="provider-section-count">
            {{ aiProviders.length }}
          </span>
        </div>
        <Button variant="primary" @click="setupFor = ''">
          <span class="model-config-btn-inner">
            <IconPlus :size="14" />
            <span>{{ t("settings.addProvider") }}</span>
          </span>
        </Button>
      </div>

      <div class="settings-panel model-provider-panel">
        <div v-if="aiProviders.length === 0" class="model-provider-empty">
          <div class="model-provider-empty-icon" aria-hidden="true">
            <IconServer :size="18" />
          </div>
          <div class="model-provider-empty-title">{{ t("settings.noProviders") }}</div>
          <div class="model-provider-empty-desc">{{ t("settings.noProvidersDesc") }}</div>
          <Button variant="primary" @click="setupFor = ''">
            <span class="model-config-btn-inner">
              <IconPlus :size="14" />
              <span>{{ t("settings.addProvider") }}</span>
            </span>
          </Button>
        </div>
        <ul v-else class="model-provider-list" :aria-busy="reorderSaving">
          <li
            v-for="provider in reorderProviders"
            :key="provider.id"
            :ref="reorderRowRef(provider.id)"
            class="model-provider-row"
            :class="{
              'is-disabled': !provider.enabled,
              'is-dragging': reorderDraggingId === provider.id,
            }"
            :data-provider-id="provider.id"
            :aria-label="t('settings.reorderProvider', { name: provider.name })"
            :tabindex="reorderDisabled ? -1 : 0"
            :aria-disabled="reorderDisabled"
            @keydown="onRowKeydown(provider.id, $event)"
            @dragstart="onRowDragStart($event)"
            @click.capture="onRowClickCapture($event)"
            @pointerdown="onRowPointerDown(provider.id, $event)"
          >
            <div class="model-provider-row-copy">
              <div class="model-provider-row-title">
                <span class="model-provider-row-name">{{ provider.name }}</span>
                <Badge v-if="defaultProviderId === provider.id" tone="success">
                  {{ t("settings.default") }}
                </Badge>
                <Badge
                  v-if="!provider.hasSecret && provider.authKind !== 'none'"
                  tone="warning"
                >
                  {{ t("settings.noSecret") }}
                </Badge>
                <Badge v-if="!provider.enabled" tone="neutral">
                  {{ t("settings.providerDisabledBadge") }}
                </Badge>
                <span
                  v-if="provider.ownerPluginId"
                  :title="
                    t('settings.pluginProviderManaged', { plugin: provider.ownerPluginId })
                  "
                >
                  <Badge tone="neutral">{{ t("settings.pluginProviderBadge") }}</Badge>
                </span>
              </div>
              <div class="model-provider-row-meta">
                <span>{{ hostFromBaseUrl(provider.baseUrl) }}</span>
                <span class="model-provider-meta-dot" aria-hidden="true">·</span>
                <span>
                  {{
                    t("settings.providerModelCount", {
                      count: provider.models?.length ?? 0,
                    })
                  }}
                </span>
                <template v-if="provider.ownerPluginId">
                  <span class="model-provider-meta-dot" aria-hidden="true">·</span>
                  <span>
                    {{
                      t("settings.pluginProviderBy", {
                        plugin: provider.ownerPluginId,
                      })
                    }}
                  </span>
                </template>
              </div>
            </div>

            <div class="model-provider-row-actions">
              <Button
                v-if="defaultProviderId !== provider.id"
                size="sm"
                variant="ghost"
                :disabled="
                  busyId === provider.id ||
                  testingId === provider.id ||
                  !providerReady(provider)
                "
                @click="
                  void setDefaultModel(provider, defaultModelIdOf(provider) ?? '')
                "
              >
                {{ t("settings.makeDefault") }}
              </Button>
              <TooltipButton
                v-if="!provider.ownerPluginId"
                type="button"
                class="icon-btn icon-btn-square model-provider-icon-btn"
                :label="t('settings.copyProvider')"
                :aria-label="t('settings.copyProvider')"
                :disabled="busyId === provider.id || testingId === provider.id"
                @click="
                  copyDraft = copyProviderConfiguration(
                    provider,
                    t('settings.copyProviderName', { name: provider.name }),
                  );
                  setupFor = '';
                "
              >
                <IconCopy :size="14" />
              </TooltipButton>
              <TooltipButton
                v-if="provider.ownerPluginId && provider.authKind === 'api_key'"
                type="button"
                class="icon-btn icon-btn-square model-provider-icon-btn"
                :label="t('settings.pluginProviderKey')"
                :aria-label="t('settings.pluginProviderKey')"
                :disabled="busyId === provider.id || testingId === provider.id"
                @click="
                  keyFor = keyFor === provider.id ? null : provider.id;
                  keyValue = '';
                "
              >
                <IconKey :size="14" />
              </TooltipButton>
              <TooltipButton
                type="button"
                class="icon-btn icon-btn-square model-provider-icon-btn"
                :label="
                  provider.ownerPluginId
                    ? t('settings.pluginProviderManaged', {
                        plugin: provider.ownerPluginId,
                      })
                    : t('settings.editProvider')
                "
                :aria-label="t('settings.editProvider')"
                :disabled="
                  busyId === provider.id ||
                  testingId === provider.id ||
                  Boolean(provider.ownerPluginId)
                "
                @click="setupFor = provider.id"
              >
                <IconPencil :size="14" />
              </TooltipButton>
              <TooltipButton
                type="button"
                class="icon-btn icon-btn-square model-provider-icon-btn"
                :class="{ 'is-testing': testingId === provider.id }"
                :label="t('settings.testConnection')"
                :aria-label="t('settings.testConnection')"
                :disabled="busyId === provider.id || testingId === provider.id"
                @click="void testProvider(provider)"
              >
                <IconPlug :size="14" />
              </TooltipButton>
              <button
                v-if="confirmDeleteId === provider.id"
                type="button"
                class="model-provider-delete-confirm"
                :disabled="busyId === provider.id || testingId === provider.id"
                @blur="confirmDeleteId = null"
                @click="void removeProvider(provider)"
              >
                {{ t("settings.deleteConfirm") }}
              </button>
              <TooltipButton
                v-else
                type="button"
                class="icon-btn icon-btn-square model-provider-icon-btn is-danger"
                :label="
                  provider.ownerPluginId
                    ? t('settings.pluginProviderManaged', {
                        plugin: provider.ownerPluginId,
                      })
                    : t('settings.delete')
                "
                :aria-label="t('settings.delete')"
                :disabled="
                  busyId === provider.id ||
                  testingId === provider.id ||
                  Boolean(provider.ownerPluginId)
                "
                @click="confirmDeleteId = provider.id"
              >
                <IconTrash :size="14" />
              </TooltipButton>
              <TooltipButton
                type="button"
                class="settings-toggle"
                :class="{ on: provider.enabled }"
                role="switch"
                :aria-checked="provider.enabled"
                :label="
                  provider.ownerPluginId
                    ? t('settings.pluginProviderManaged', {
                        plugin: provider.ownerPluginId,
                      })
                    : t('settings.enabledToggle')
                "
                :aria-label="t('settings.enabledToggle')"
                :disabled="
                  busyId === provider.id ||
                  testingId === provider.id ||
                  Boolean(provider.ownerPluginId)
                "
                @click="void toggleEnabled(provider)"
              >
                <span class="settings-toggle-thumb" />
              </TooltipButton>
            </div>

            <div v-if="keyFor === provider.id" class="model-provider-key-entry">
              <Field
                :label="t('settings.pluginProviderKey')"
                :hint="t('settings.pluginProviderKeyHint')"
              >
                <Input
                  type="password"
                  autofocus
                  :value="keyValue"
                  :placeholder="provider.hasSecret ? t('settings.apiKeyKeepHint') : undefined"
                  @input="keyValue = ($event.target as HTMLInputElement).value"
                  @keydown="onKeyEntryKeydown($event, provider)"
                />
              </Field>
              <div class="model-provider-key-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  :disabled="busyId === provider.id"
                  @click="keyFor = null"
                >
                  {{ t("settings.cancel") }}
                </Button>
                <Button
                  v-if="provider.hasSecret"
                  size="sm"
                  variant="ghost"
                  :disabled="busyId === provider.id"
                  @click="void saveProviderKey(provider, '')"
                >
                  {{ t("settings.pluginProviderKeyRemove") }}
                </Button>
                <Button
                  size="sm"
                  :disabled="busyId === provider.id || !keyValue.trim()"
                  @click="void saveProviderKey(provider, keyValue)"
                >
                  {{ t("settings.save") }}
                </Button>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <VendorAccountsSection />

    <div class="model-catalog-status">
      <span class="model-catalog-status-text">{{ catalogStatusLine }}</span>
    </div>

    <ProviderSetupDialog
      v-if="setupFor !== null"
      :provider="editingProvider"
      :initial-draft="copyDraft"
      @close="
        setupFor = null;
        copyDraft = null;
      "
      @saved="(saved, models) => void afterSaved(saved, models)"
    />
  </div>
</template>
