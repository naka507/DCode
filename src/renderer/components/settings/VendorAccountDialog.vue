<script setup lang="ts">
/**
 * Edit one vendor (OAuth) account: its label and the models it may use.
 *
 * The `VendorAccountDialog` component. The list
 * comes from the account itself: the host answers
 * `api.listProviderModels({ providerId })` from the signed-in account's
 * entitlements, so this dialog shows what the account can actually run rather
 * than every model the vendor publishes. Choosing among those rows is
 * `ModelSelectionPanes`, the same picker the AI service dialog renders, so an
 * account is not a reduced version of a service.
 *
 * Deliberate choices:
 *
 *  1. **`portalOverlay(node)` → `<Teleport :to="overlayRoot()">`**, the
 *     viewport-fixed host the `.overlay` dialog family uses (`ui-kit.css` sets
 *     `pointer-events: none` on the host and re-enables them for a direct
 *     `.overlay` child). Both the dialog and its advanced overlay teleport.
 *  2. **`onClose` / `onSave` stay callback props**:
 *     the caller passes `() => (editingAccount = null)` and a `saveAccount`
 *     wrapper, and the child reads them at call time. `saving` is the same kind
 *     of value, not an event.
 *  3. **The Escape listener is installed once and reads the live `saving` ref**
 *     (the shape `ProviderSetupDialog.vue` uses) rather than re-binding on
 *     `[advancedOpen, onClose, saving]`.
 *  4. **The `useState` initializers that read props run once at setup**, the same
 *     lifetime a lazy initializer had; the dialog is mounted per account
 *     row, so nothing re-seeds them.
 *  5. **`useProviderModels(...)` and `useModelSelection(...)` take getters.**
 *     A Vue composable is called once from `setup`, so `headers` and `models`
 *     are read through `() => …` exactly where the per-render hook body
 *     read them (see the two composables' own notes).
 *  6. **`pairsToRecord` / `recordToPairs` come from the split-out
 *     `../extensions/key-value-rows`**, where the framework-free half of
 *     `KeyValueRows` lives.
 *  7. **`VendorAccountForm` is exported from the module block below**, because
 *     `<script setup>` cannot export a type that `VendorAccountsSection.vue`
 *     imports.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  bindingForCustomModel,
  type ModelBinding,
  type ProviderPublic,
} from "@dcode/shared";
import { overlayRoot } from "../../lib/overlay-root";
import {
  pairsToRecord,
  recordToPairs,
  type KeyValuePair,
} from "../extensions/key-value-rows";
import Button from "../ui/Button.vue";
import Field from "../ui/Field.vue";
import Input from "../ui/Input.vue";
import ProviderHeadersEditor from "./ProviderHeadersEditor.vue";
import { useProviderModels } from "./useProviderModels";
import ModelSelectionPanes from "./ModelSelectionPanes.vue";
import { useModelSelection } from "./model-selection-panes";

const props = defineProps<{
  provider: ProviderPublic;
  initialName: string;
  onClose: () => void;
  onSave: (form: VendorAccountForm) => void;
  saving: boolean;
}>();

const { t } = useI18n();

const name = ref(props.initialName);
const headerPairs = ref<KeyValuePair[]>(recordToPairs(props.provider.headers));
const advancedOpen = ref(false);
const models = ref<ModelBinding[]>(
  props.provider.models.length > 0
    ? props.provider.models
    : props.provider.defaultModelId
      ? [bindingForCustomModel(props.provider.defaultModelId)]
      : [],
);

// A vendor account has no typed key: the host resolves the stored login.
const headers = computed(() => pairsToRecord(headerPairs.value));
const discovery = useProviderModels(() => ({
  active: true,
  baseUrl: props.provider.baseUrl ?? "",
  apiKey: "",
  apiStyle: props.provider.apiStyle ?? "",
  headers: headers.value,
  providerId: props.provider.id,
}));
const selection = useModelSelection(
  () => discovery,
  () => models.value,
  (update) => {
    models.value = update(models.value);
  },
);

/* See note 3: installed once, reading the live `saving` ref. */
function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || props.saving) return;
  if (advancedOpen.value) {
    advancedOpen.value = false;
    return;
  }
  props.onClose();
}

onMounted(() => window.addEventListener("keydown", onKeyDown));
onUnmounted(() => window.removeEventListener("keydown", onKeyDown));

const canSave = computed(
  () => !props.saving && !!name.value.trim() && models.value.length > 0,
);

function submit() {
  if (!canSave.value) return;
  // Narrowed like a service's bindings, so an account cannot persist a
  // thinking level the runtime would discard. The account's default model is
  // always the first binding, so reordering or removing the head is the only
  // way to change it.
  const persisted = selection.bindingsToPersist;
  props.onSave({
    name: name.value.trim(),
    modelId: persisted[0]!.id,
    models: persisted,
    headers: headers.value,
  });
}

function onAdvancedOverlayClick(event: MouseEvent) {
  event.stopPropagation();
  if (event.target === event.currentTarget) advancedOpen.value = false;
}
</script>

<script lang="ts">
/**
 * `<script setup>` cannot export, so the form shape the caller hands back to
 * `saveAccount` lives in the module block — the idiom `ServicePicker.vue` and
 * `SubagentEditorSheet.vue` already use for a value a sibling imports.
 */
export type VendorAccountForm = {
  name: string;
  /** The account's default model; always `models[0]`. */
  modelId: string;
  models: ModelBinding[];
  headers: Record<string, string>;
};
</script>

<template>
  <Teleport :to="overlayRoot()">
    <div
      class="overlay vendor-account-overlay"
      role="presentation"
      @click="saving ? undefined : onClose()"
    >
      <div
        class="dialog vendor-account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vendor-account-title"
        @click="$event.stopPropagation()"
      >
        <div class="vendor-account-head">
          <h3 id="vendor-account-title" class="vendor-account-title">
            {{ t("settings.editVendorAccount") }}
          </h3>
          <Button variant="ghost" size="sm" @click="advancedOpen = true">
            {{ t("settings.advancedSettings") }}
          </Button>
        </div>

        <div class="vendor-account-body">
          <Field :label="t('settings.name')">
            <Input
              :value="name"
              autofocus
              @input="name = ($event.target as HTMLInputElement).value"
            />
          </Field>

          <ModelSelectionPanes
            :discovery="discovery"
            :selection="selection"
            :list-title="t('settings.accountModels')"
            :busy="saving"
            :on-reload="discovery.reload"
            :api-style="provider.apiStyle ?? ''"
          />
        </div>

        <div class="vendor-account-actions">
          <Button variant="ghost" :disabled="saving" @click="onClose()">
            {{ t("settings.cancel") }}
          </Button>
          <Button variant="primary" :disabled="!canSave" @click="submit">
            {{ t("settings.save") }}
          </Button>
        </div>
      </div>

      <div
        v-if="advancedOpen"
        class="overlay provider-advanced-overlay"
        role="presentation"
        @click="onAdvancedOverlayClick"
      >
        <div
          class="dialog provider-advanced-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="vendor-advanced-title"
          @click="$event.stopPropagation()"
        >
          <div class="provider-advanced-head">
            <h4 id="vendor-advanced-title" class="provider-advanced-title">
              {{ t("settings.advancedSettings") }}
            </h4>
            <Button variant="ghost" size="sm" @click="advancedOpen = false">
              {{ t("settings.close") }}
            </Button>
          </div>
          <div class="provider-advanced-body">
            <div class="provider-setup-advanced">
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
