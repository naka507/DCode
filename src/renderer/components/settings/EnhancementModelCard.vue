<script setup lang="ts">
/**
 * Enhancement model and reasoning rows (ADR 0121).
 *
 * Which model rewrites the Composer draft, and with how much reasoning, live
 * on the Settings → AI Prompt enhancement card, as rows below the custom-template
 * switch. They are rows rather than a second card so the template, model, and
 * reasoning for the same action share one heading.
 *
 * The picker reuses the default-model anchored menu so Settings offers one kind
 * of model picker, and the reasoning row reuses the shared settings menu select.
 * The `EnhancementModelCard` component. The decisions that are not mechanical:
 *
 *  1. **`settings`, `providers` and `providerModels` are `store.appState` reads**
 * (`store.appState?.providers`), the tracked form of
 * `useAppStore((state) => state.providers)`. `save` keeps its own
 *     write path — `api.setSettings` then `store.setState({ settings })` — rather
 *     than routing through the settings page, because these rows own a model pin
 *     that needs no provider refresh.
 * 2. **`useMemo` is `computed`**, one per memo, and `picking` / `query`
 *     are `ref`s. The memos had the same dependency lists, so the
 *     mapping is one-to-one.
 * 3. **The early `if (!settings) return null` is `v-if="settings"`.** Every hook
 *     used to run before it; the Vue setup runs every `computed` regardless, so
 *     the template guard is the only equivalent needed.
 *  4. **`AnchoredMenu`'s `trigger(ref)` render prop is its `#trigger` slot**, the
 *     shape `ModelConfigPage.vue` and `SubagentModelPicker.vue` already use.
 *  5. **`cx("model-default-option", isCurrent && "is-current")` is a static
 *     `class` plus an object `:class` binding**, which is the form the class-name
 *     contract reads.
 *  6. **`aria-hidden` is explicit (`aria-hidden="true"`)** on the chevron, the
 *     search glyph and the option check: a bare Vue attribute renders `""`,
 *     so the explicit `"true"` is written.
 *  7. **The per-row `startsGroup` / `has-divider` pair is a template helper**
 *     (`startsGroup(index)`), because a Vue template cannot declare the
 * `const previous = visible[index - 1]` the `map` callback held.
 * 8. **`detail` is the `#detail` slot.** The `SettingsRow` split
 *     explanatory copy (behind a help icon) from `detail` (a live value, always
 *     visible); dcode's `SettingsRow` took the same split in the same commit,
 *     so the pinned model pair renders in `#detail`.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  THINKING_LEVELS,
  canonicalThinkingLevel,
  modelIdsMatch,
  type AppSettings,
  type ThinkingLevel,
} from "@dcode/shared";
import {
  thinkingLevelForProvider,
  thinkingProviderForModel,
} from "../../features/chat/composer/model";
import { useAppStore } from "../../stores/app-store";
import { api } from "../../lib/api";
import { IconCheck, IconChevronDown, IconSearch } from "../../lib/icons";
import Button from "../ui/Button.vue";
import Input from "../ui/Input.vue";
import AnchoredMenu from "./AnchoredMenu.vue";
import SettingsMenuSelect from "./SettingsMenuSelect.vue";
import SettingsRow from "../../features/settings/primitives/SettingsRow.vue";
import { defaultModelOptions } from "./default-model";
import {
  groupSubagentModelChoices,
  subagentModelChoices,
  subagentModelOrphanPin,
  subagentModelSelectValue,
} from "./subagent-models";

const { t } = useI18n();
const store = useAppStore();

const providers = computed(() => store.appState?.providers ?? []);
const providerModels = computed(() => store.appState?.providerModels ?? {});
const settings = computed(() => store.appState?.settings);

const picking = ref(false);
const query = ref("");

const choices = computed(() => subagentModelChoices(providers.value));
const groups = computed(() => groupSubagentModelChoices(choices.value));
const pinnedValue = computed(() => {
  const current = settings.value;
  if (!current?.promptEnhancementProviderId || !current?.promptEnhancementModelId) {
    return "";
  }
  return subagentModelSelectValue(
    `${current.promptEnhancementProviderId}/${current.promptEnhancementModelId}`,
    choices.value,
  );
});
const orphanPin = computed(() =>
  subagentModelOrphanPin(pinnedValue.value, choices.value),
);
/** The menu lists runnable providers, same set the Composer would offer. */
const options = computed(() =>
  defaultModelOptions(providers.value.filter((provider) => provider.enabled)),
);
const visible = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return options.value;
  return options.value.filter(({ provider, modelId }) =>
    `${provider.name} ${modelId}`.toLowerCase().includes(needle),
  );
});

const pinnedProviderId = computed(
  () => settings.value?.promptEnhancementProviderId ?? "",
);
const pinnedModelId = computed(() => settings.value?.promptEnhancementModelId ?? "");
const pinnedProvider = computed(
  () => providers.value.find((provider) => provider.id === pinnedProviderId.value) ?? null,
);
/**
 * The repository resolves a model's real reasoning ladder from its binding's
 * `thinkingLevels`, then the live catalog, then the provider default. Reusing
 * it keeps this row honest: a model without reasoning offers only `off`
 * instead of the full canonical list, which is what this row showed before.
 */
const reasoningProvider = computed(() => {
  if (!pinnedProviderId.value || !pinnedModelId.value) return null;
  return thinkingProviderForModel(
    pinnedProvider.value,
    pinnedModelId.value,
    providerModels.value[pinnedProviderId.value],
  );
});
const reasoningLevels = computed(() =>
  reasoningProvider.value?.supportsReasoning
    ? THINKING_LEVELS.filter((level) =>
        (reasoningProvider.value?.supportedThinkingLevels ?? []).includes(level),
      )
    : [],
);
// A pinned model defines the ladder; with no pin the request follows the
// session's model, whose ladder is not knowable here, so offer the full list.
// A model without reasoning still lists `off` so the closed trigger does not
// show the raw id, and the row is disabled.
const noReasoning = computed(
  () =>
    Boolean(reasoningProvider.value) &&
    reasoningProvider.value?.supportsReasoning !== true,
);
const levelOptions = computed<ThinkingLevel[]>(() => {
  if (noReasoning.value) return ["off"];
  if (!reasoningProvider.value) return [...THINKING_LEVELS];
  return reasoningLevels.value.length > 0 ? reasoningLevels.value : ["off"];
});
const storedReasoning = computed(
  () => settings.value?.promptEnhancementThinkingLevel ?? "off",
);
const reasoning = computed(() => {
  const provider = reasoningProvider.value;
  if (!provider) return storedReasoning.value;
  return canonicalThinkingLevel(
    thinkingLevelForProvider(provider, storedReasoning.value),
  );
});

/** True on a row whose predecessor belongs to another provider. */
function startsGroup(index: number): boolean {
  const row = visible.value[index];
  const previous = visible.value[index - 1];
  return !previous || !row || previous.provider.id !== row.provider.id;
}

async function save(patch: Partial<AppSettings>): Promise<void> {
  const current = settings.value;
  if (!current) return;
  const next = { ...current, ...patch };
  try {
    await api.setSettings(next);
    store.setState({ settings: next });
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
  }
}

function pickModel(providerId: string, modelId: string): Promise<void> {
  // Switching model can change the reasoning ladder (a model without
  // reasoning has none), so re-clamp the stored level onto the new model.
  const nextProvider = providerId
    ? thinkingProviderForModel(
        providers.value.find((provider) => provider.id === providerId) ?? null,
        modelId,
        providerModels.value[providerId],
      )
    : null;
  const stored = settings.value?.promptEnhancementThinkingLevel ?? "off";
  return save({
    promptEnhancementProviderId: providerId,
    promptEnhancementModelId: modelId,
    promptEnhancementThinkingLevel: nextProvider
      ? canonicalThinkingLevel(thinkingLevelForProvider(nextProvider, stored))
      : stored,
  }).then(() => {
    picking.value = false;
  });
}

function onTriggerClick(): void {
  query.value = "";
  picking.value = !picking.value;
}

function onReasoningChange(id: string): void {
  // Clamp through the same resolver the row displays, so the value stored is
  // always one this model can run.
  const provider = reasoningProvider.value;
  void save({
    promptEnhancementThinkingLevel: provider
      ? canonicalThinkingLevel(thinkingLevelForProvider(provider, id as ThinkingLevel))
      : (id as ThinkingLevel),
  });
}
</script>

<template>
  <template v-if="settings">
    <SettingsRow :title="t('settings.promptEnhancementModel')">
      <template #detail>
        <span
          v-if="settings.promptEnhancementProviderId && settings.promptEnhancementModelId"
          class="model-default-value"
        >
          <span class="model-default-provider">
            {{ pinnedProvider?.name ?? settings.promptEnhancementProviderId }}
          </span>
          <span class="model-default-sep" aria-hidden="true">·</span>
          <span class="model-default-model font-mono">
            {{ settings.promptEnhancementModelId }}
          </span>
          <span v-if="!pinnedProvider || orphanPin" class="model-default-empty">
            {{ " " }}{{ t("settings.promptEnhancementModelUnavailable") }}
          </span>
        </span>
        <span v-else class="model-default-empty">
          {{ t("settings.promptEnhancementModelFollow") }}
        </span>
      </template>

      <AnchoredMenu
        class="model-default-anchor"
        :open="picking"
        menu-class-name="model-default-menu"
        :label="t('settings.promptEnhancementModel')"
        align="end"
        @close="picking = false"
      >
        <template #trigger="{ setAnchor }">
          <Button
            :ref="setAnchor"
            class="settings-text-action model-default-trigger"
            variant="ghost"
            :disabled="groups.length === 0 && !orphanPin"
            aria-haspopup="listbox"
            :aria-expanded="picking"
            @click="onTriggerClick"
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
            :value="query"
            :placeholder="t('settings.defaultModelSearch')"
            :aria-label="t('settings.defaultModelSearch')"
            autofocus
            @input="query = ($event.target as HTMLInputElement).value"
          />
        </div>
        <div class="model-default-results" role="presentation">
          <div v-if="visible.length === 0" class="model-default-no-results">
            {{ t("settings.noModelMatches") }}
          </div>
          <ul class="model-default-list">
            <li>
              <button
                type="button"
                role="option"
                :aria-selected="!settings.promptEnhancementProviderId"
                :aria-label="t('settings.promptEnhancementModelFollow')"
                class="model-default-option"
                :class="{ 'is-current': !settings.promptEnhancementProviderId }"
                @click="void pickModel('', '')"
              >
                <span class="model-default-option-check" aria-hidden="true">
                  <IconCheck v-if="!settings.promptEnhancementProviderId" :size="12" />
                </span>
                <span class="model-default-option-model">
                  {{ t("settings.promptEnhancementModelFollow") }}
                </span>
              </button>
            </li>
            <li
              v-for="(row, index) in visible"
              :key="`${row.provider.id}:${row.modelId}`"
            >
              <div
                v-if="startsGroup(index)"
                class="model-default-provider-group"
                :class="{ 'has-divider': index > 0 }"
              >
                {{ row.provider.name }}
              </div>
              <button
                type="button"
                role="option"
                :aria-selected="
                  settings.promptEnhancementProviderId === row.provider.id &&
                  modelIdsMatch(settings.promptEnhancementModelId ?? '', row.modelId)
                "
                :aria-label="`${row.provider.name} · ${row.modelId}`"
                class="model-default-option"
                :class="{
                  'is-current':
                    settings.promptEnhancementProviderId === row.provider.id &&
                    modelIdsMatch(settings.promptEnhancementModelId ?? '', row.modelId),
                }"
                @click="void pickModel(row.provider.id, row.modelId)"
              >
                <span class="model-default-option-check" aria-hidden="true">
                  <IconCheck
                    v-if="
                      settings.promptEnhancementProviderId === row.provider.id &&
                      modelIdsMatch(settings.promptEnhancementModelId ?? '', row.modelId)
                    "
                    :size="12"
                  />
                </span>
                <span class="model-default-option-model font-mono">
                  {{ row.modelId }}
                </span>
              </button>
            </li>
          </ul>
        </div>
      </AnchoredMenu>
    </SettingsRow>

    <SettingsRow
      :title="t('settings.promptEnhancementThinking')"
      :description="t('settings.promptEnhancementThinkingDesc')"
    >
      <SettingsMenuSelect
        :label="t('settings.promptEnhancementThinking')"
        :value="reasoning"
        :disabled="noReasoning"
        :options="
          levelOptions.map((level) => ({
            id: level,
            label:
              level === 'off' ? t('settings.promptEnhancementThinkingOff') : level,
          }))
        "
        @change="onReasoningChange"
      />
    </SettingsRow>
  </template>
</template>
