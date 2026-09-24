<script setup lang="ts">
/**
 * Sign in with a vendor subscription instead of pasting an API key (ADR 0098).
 * Vendor accounts are separate from API providers in the settings hierarchy;
 * each account row owns exactly one OAuth provider row and can be removed on
 * its own.
 *
 * The `VendorAccountsSection` component.
 *
 * Deliberate choices:
 *
 * 1. **Store selectors become `store.appState` reads.** The earlier version destructured
 *     `providers`, `settings`, `refreshProviders` and `showToast`; here they are
 *     `computed(() => store.appState?.field)` or `store.appState?.action()`.
 *  2. **`useAppStore.setState({ settings })` is `store.setState({ settings })`**,
 *     the same commit shape through this tree's Pinia store.
 *  3. **`useCallback(loadVendors)` and its mount effect are `onMounted`.** The
 *     loader has no reactive inputs, so it is a plain function; the effect's
 *     empty dependency list makes it a single mount run.
 *  4. **The `login?.session.dispose()` effect is `onUnmounted` plus a `watch`.**
 * the `useEffect(() => () => login?.session.dispose(), [login])`
 *     disposes the *previous* session whenever the in-flight login changes, and
 *     the last one on unmount. A `watch` with the returned cleanup plus an
 *     `onUnmounted` run reproduces both, in that order.
 *  5. **`onLoginDone`'s `useCallback` is a plain function.** It was memoized for
 *     a prop identity; nothing here compares it.
 *  6. **The `if (!vendors || vendors.length === 0) return null` early return is
 *     the root `v-if`.** A Vue `setup` cannot return early with markup, so the
 *     section renders nothing until the runtime reports a vendor — the same DOM.
 *  7. **The per-row derivations are one `accounts` computed of view rows.** A Vue
 *     template cannot declare locals per iteration, so `provider`,
 *     `accountName`, `duplicateLabel`, `confirming`, `busy` and `testing` are
 *     resolved once in a computed that reads the same refs — the numbers in the
 *     header can therefore never disagree with the rows below them.
 *  8. **`VendorPickerDialog`'s `onPick` / `onClose` stay callback props** (it
 *     declares them as such) and `OAuthLoginDialog`'s `onDone` / `onClose` too,
 *     because `onLoginDone` closes over the in-flight login. `VendorAccountDialog`
 *     and `OAuthLoginDialog` are `<Teleport>`-based overlays now.
 *
 * `vendor-accounts-block` is a literal class in the markup that
 * neither stylesheet defines; it is allowlisted for this file in
 * `tests/helpers/class-contract.mjs`.
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { OAuthAccount, OAuthVendor, ProviderPublic } from "@dcode/shared";
import { useAppStore } from "../../stores/app-store";
import { api } from "../../lib/api";
import {
  beginOAuthLogin,
  type OAuthLoginSession,
} from "../../lib/oauth-login-session";
import Badge from "../ui/Badge.vue";
import Button from "../ui/Button.vue";
import TooltipButton from "../TooltipButton.vue";
import { IconKey, IconPencil, IconPlug, IconTrash } from "../../lib/icons";
import OAuthLoginDialog from "./OAuthLoginDialog.vue";
import VendorAccountDialog, {
  type VendorAccountForm,
} from "./VendorAccountDialog.vue";
import VendorPickerDialog from "./VendorPickerDialog.vue";

/** A login in flight, together with the dialog reporting on it. */
type ActiveLogin = { vendor: OAuthVendor; session: OAuthLoginSession };

type AccountEntry = {
  vendor: OAuthVendor;
  account: OAuthAccount;
  ordinal: number;
  totalForVendor: number;
};

/** One account row, with every per-row derivation resolved. */
type AccountRow = {
  /** The list entry the row came from, so its handlers take the same object. */
  entry: AccountEntry;
  vendor: OAuthVendor;
  account: OAuthAccount;
  provider: ProviderPublic | undefined;
  accountName: string;
  duplicateLabel: string;
  confirming: boolean;
  rowBusy: boolean;
  testing: boolean;
};

function providerIsReady(provider: ProviderPublic, excludedId?: string): boolean {
  return (
    provider.id !== excludedId &&
    provider.enabled &&
    !!provider.defaultModelId &&
    (provider.hasSecret || provider.hasOauth || provider.authKind === "none")
  );
}

const { t } = useI18n();
const store = useAppStore();

const providers = computed(() => store.appState?.providers ?? []);
const settings = computed(() => store.appState?.settings);

const vendors = ref<OAuthVendor[] | null>(null);
const busyAccount = ref<string | null>(null);
const confirmDeleteId = ref<string | null>(null);
const picking = ref(false);
const login = ref<ActiveLogin | null>(null);
const editingAccount = ref<AccountEntry | null>(null);
const savingAccount = ref(false);
const testingAccount = ref<string | null>(null);

async function loadVendors(): Promise<void> {
  try {
    const result = await api.listOauthVendors();
    vendors.value = result.vendors;
  } catch {
    // A runtime without OAuth flows registered simply has no accounts to
    // offer; the section stays hidden rather than showing an error.
    vendors.value = [];
  }
}

/* See note 3: an empty dependency list is a single mount run. */
onMounted(() => {
  void loadVendors();
});

/*
  See note 4. Closing the dialog — done, cancelled, or the whole page going away
  — stops the renderer listening. Cancelling the attempt itself is the dialog's
  job. The watcher's cleanup disposes the session it replaced; the unmount hook
  disposes the last one.
*/
watch(
  login,
  (_next, previous) => {
    previous?.session.dispose();
  },
  { flush: "post" },
);
onUnmounted(() => {
  login.value?.session.dispose();
});

const accounts = computed<AccountEntry[]>(() => {
  const list = vendors.value;
  if (!list) return [];
  return list.flatMap((vendor) => {
    const totalForVendor = vendor.accounts.length;
    return vendor.accounts.map((account, index) => ({
      vendor,
      account,
      ordinal: index + 1,
      totalForVendor,
    }));
  });
});

/*
  See note 7: what the template would otherwise compute inside the `v-for`. The
  original entry rides along so a row's handlers receive the same object the
  list was built from, rather than re-deriving it from a provider id.
*/
const accountRows = computed<AccountRow[]>(() =>
  accounts.value.map((entry) => {
    const { vendor, account } = entry;
    const provider = providers.value.find(
      (candidate) => candidate.id === account.providerId,
    );
    return {
      entry,
      vendor,
      account,
      provider,
      accountName:
        account.accountLabel ||
        provider?.oauthAccountLabel ||
        t("settings.vendorSignedInGeneric"),
      duplicateLabel:
        entry.totalForVendor > 1
          ? ` · ${t("settings.vendorAccountNumber", { number: entry.ordinal })}`
          : "",
      confirming: confirmDeleteId.value === account.providerId,
      rowBusy:
        busyAccount.value === account.providerId ||
        testingAccount.value === account.providerId,
      testing: testingAccount.value === account.providerId,
    };
  }),
);

async function removeAccount(entry: AccountEntry): Promise<void> {
  const { account, vendor } = entry;
  confirmDeleteId.value = null;
  busyAccount.value = account.providerId;
  try {
    await api.deleteOauthAccount(account.providerId);

    // A deleted account cannot remain the global default. Pick the first
    // still-ready service, including an API provider, so the model picker
    // does not point at a deleted row after refresh.
    const current = settings.value;
    if (current?.defaultProviderId === account.providerId) {
      const next = providers.value.find((provider) =>
        providerIsReady(provider, account.providerId),
      );
      const nextSettings = {
        ...current,
        defaultProviderId: next?.id ?? "",
        defaultModelId: next?.defaultModelId ?? "",
      };
      await api.setSettings(nextSettings);
      store.setState({ settings: nextSettings });
    }
    await Promise.all([loadVendors(), store.appState?.refreshProviders()]);
    store.appState?.showToast(
      t("settings.vendorAccountRemoved", { vendor: vendor.name }),
      { variant: "success" },
    );
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
  } finally {
    busyAccount.value = null;
  }
}

async function saveAccount(form: VendorAccountForm): Promise<void> {
  const entry = editingAccount.value;
  const provider = entry
    ? providers.value.find((candidate) => candidate.id === entry.account.providerId)
    : null;
  if (!entry || !provider || !form.name.trim() || !form.modelId.trim()) return;
  savingAccount.value = true;
  try {
    await api.updateProvider({
      id: provider.id,
      oauthAccountLabel: form.name.trim(),
      defaultModelId: form.modelId.trim(),
      models: form.models,
      headers: form.headers,
    });
    const current = settings.value;
    if (current?.defaultProviderId === provider.id) {
      await api.setSettings({
        ...current,
        defaultModelId: form.modelId.trim(),
      });
    }
    await Promise.all([loadVendors(), store.appState?.refreshProviders()]);
    editingAccount.value = null;
    store.appState?.showToast(t("settings.vendorAccountUpdated"), {
      variant: "success",
    });
  } catch (error) {
    store.appState?.showToast(
      error instanceof Error ? error.message : String(error),
      { variant: "error" },
    );
  } finally {
    savingAccount.value = false;
  }
}

async function testAccount(entry: AccountEntry): Promise<void> {
  const provider = providers.value.find(
    (candidate) => candidate.id === entry.account.providerId,
  );
  if (!provider) return;
  testingAccount.value = provider.id;
  try {
    const result = (await api.testProvider(provider.id)) as {
      ok?: boolean;
      message?: string;
      status?: number;
    };
    if (result.ok) {
      store.appState?.showToast(t("settings.testOk"), { variant: "success" });
    } else {
      store.appState?.showToast(
        result.message ||
          (result.status
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
    testingAccount.value = null;
  }
}

 /* See note 5: the memo existed for a prop identity, not for a value. */
function onLoginDone(accountLabel?: string): void {
  const vendorName = login.value?.vendor.name ?? "";
  login.value = null;
  void loadVendors();
  void store.appState?.refreshProviders();
  store.appState?.showToast(
    accountLabel
      ? t("settings.vendorSignedInAs", { account: accountLabel })
      : t("settings.vendorSignedIn", { vendor: vendorName }),
    { variant: "success" },
  );
}

/* See note 8: the dialog reads the provider row it edits. */
const editingProvider = computed(() =>
  editingAccount.value
    ? (providers.value.find(
        (candidate) => candidate.id === editingAccount.value?.account.providerId,
      ) ?? null)
    : null,
);
const editingName = computed(() => {
  const entry = editingAccount.value;
  const provider = editingProvider.value;
  if (!entry || !provider) return "";
  return (
    entry.account.accountLabel || provider.oauthAccountLabel || provider.name
  );
});

function onPickVendor(vendor: OAuthVendor): void {
  picking.value = false;
  // Started here, not in the dialog: a click happens once, where StrictMode
  // would run a mount effect twice and open two browsers.
  login.value = {
    vendor,
    session: beginOAuthLogin({ api, vendorId: vendor.vendorId }),
  };
}
</script>

<template>
  <!-- See note 6: nothing to offer until the runtime reports an OAuth vendor. -->
  <section v-if="vendors && vendors.length > 0" class="settings-card-block vendor-accounts-block">
    <div class="provider-section-head">
      <div>
        <div class="settings-card-heading-line">
          <h3 class="settings-card-heading">{{ t("settings.vendorAccounts") }}</h3>
          <span v-if="accounts.length > 0" class="provider-section-count">
            {{ accounts.length }}
          </span>
        </div>
      </div>
      <Button variant="primary" :disabled="login !== null" @click="picking = true">
        <span class="vendor-btn-inner">
          <IconKey :size="14" />
          <span>{{ t("settings.vendorAddAccount") }}</span>
        </span>
      </Button>
    </div>

    <div class="settings-panel provider-list-panel">
      <div v-if="accounts.length === 0" class="vendor-account-empty">
        {{ t("settings.vendorNoAccounts") }}
      </div>
      <div v-else class="provider-row-list">
        <div
          v-for="row in accountRows"
          :key="row.account.providerId"
          class="provider-row vendor-account-row"
          :class="{ 'is-disconnected': !row.account.connected }"
        >
          <div class="provider-row-info">
            <div class="provider-row-title-line">
              <span class="provider-row-name">{{ row.vendor.name }}</span>
              <Badge v-if="row.vendor.isSubscription" tone="neutral">
                {{ t("settings.vendorSubscription") }}
              </Badge>
              <Badge :tone="row.account.connected ? 'success' : 'warning'">
                {{
                  row.account.connected
                    ? t("settings.vendorConnected")
                    : t("settings.vendorDisconnected")
                }}
              </Badge>
            </div>
            <div class="provider-row-meta">
              <span class="vendor-account-label">
                {{ row.accountName }}{{ row.duplicateLabel }}
              </span>
            </div>
            <div v-if="!row.account.connected" class="vendor-account-status">
              {{ t("settings.vendorDisconnectedDesc") }}
            </div>
          </div>
          <div class="provider-row-actions">
            <TooltipButton
              type="button"
              class="icon-btn provider-icon-btn"
              :label="t('settings.editVendorAccount')"
              :aria-label="t('settings.editVendorAccount')"
              :disabled="row.rowBusy || !row.provider"
              @click="editingAccount = row.entry"
            >
              <IconPencil :size="14" />
            </TooltipButton>
            <TooltipButton
              type="button"
              class="icon-btn provider-icon-btn"
              :class="{ 'is-testing': row.testing }"
              :label="t('settings.testConnection')"
              :aria-label="t('settings.testConnection')"
              :disabled="row.rowBusy || !row.provider"
              @click="void testAccount(row.entry)"
            >
              <IconPlug :size="14" />
            </TooltipButton>
            <button
              v-if="row.confirming"
              type="button"
              class="provider-delete-confirm"
              :disabled="row.rowBusy"
              @blur="confirmDeleteId = null"
              @click="void removeAccount(row.entry)"
            >
              {{ t("settings.deleteConfirm") }}
            </button>
            <TooltipButton
              v-else
              type="button"
              class="icon-btn provider-icon-btn provider-icon-btn-danger"
              :label="t('settings.vendorRemoveAccount')"
              :aria-label="t('settings.vendorRemoveAccount')"
              :disabled="row.rowBusy"
              @click="confirmDeleteId = row.account.providerId"
            >
              <IconTrash :size="14" />
            </TooltipButton>
          </div>
        </div>
      </div>
    </div>

    <VendorPickerDialog
      v-if="picking"
      :vendors="vendors ?? []"
      :on-pick="onPickVendor"
      :on-close="() => (picking = false)"
    />

    <VendorAccountDialog
      v-if="editingAccount && editingProvider"
      :provider="editingProvider"
      :initial-name="editingName"
      :saving="savingAccount"
      :on-close="() => (editingAccount = null)"
      :on-save="(form) => void saveAccount(form)"
    />

    <OAuthLoginDialog
      v-if="login"
      :vendor="login.vendor"
      :session="login.session"
      :on-done="onLoginDone"
      :on-close="
        () => {
          login = null;
          void loadVendors();
        }
      "
    />
  </section>
</template>
