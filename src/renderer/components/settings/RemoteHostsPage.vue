<script setup lang="ts">
/**
 * Settings destination for paired remote `pi-host` machines (R2b pairing UX,
 * ADR 0286 §Registry).
 *
 * Inventory of
 * `<dataDir>/remote-hosts.json` plus one Add form: SSH install first, URL +
 * pairing token second. Instructional copy stays out of the renderer. The
 * destination is marked Experimental on the settings rail and page title;
 * pairing and SSH bootstrap still call the same IPC. A password typed into the
 * SSH form lives in this component's state only; it is never persisted or
 * logged here.
 */
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import type {
  RemoteControlHostStatus,
  RemoteHostSshAuth,
  RemoteHostSummary,
} from "@dcode/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import Badge from "../ui/Badge.vue";
import Button from "../ui/Button.vue";
import Field from "../ui/Field.vue";
import HelpIcon from "../ui/HelpIcon.vue";
import Input from "../ui/Input.vue";
import PasswordInput from "../ui/PasswordInput.vue";

type AddMode = "ssh" | "pair";

type PairForm = {
  url: string;
  pairingToken: string;
  label: string;
};

const EMPTY_FORM: PairForm = { url: "", pairingToken: "", label: "" };

type SshForm = {
  label: string;
  host: string;
  user: string;
  port: string;
  identityFile: string;
  auth: RemoteHostSshAuth;
  password: string;
};

const EMPTY_SSH_FORM: SshForm = {
  label: "",
  host: "",
  user: "",
  port: "",
  identityFile: "",
  auth: "key",
  password: "",
};

const { t } = useI18n();
const store = useAppStore();

const hosts = ref<RemoteHostSummary[] | null>(null);
const error = ref<string | null>(null);
const form = reactive<PairForm>({ ...EMPTY_FORM });
const pairing = ref(false);
const removing = ref<string | null>(null);
const sshForm = reactive<SshForm>({ ...EMPTY_SSH_FORM });
const installing = ref(false);
const addMode = ref<AddMode>("ssh");

const controlStatus = ref<RemoteControlHostStatus | null>(null);
const controlBusy = ref(false);

/** `Input.vue` follows the `:value` + `@input` convention, not `v-model`. */
function fieldValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

async function refresh() {
  try {
    const result = await api.listRemoteHosts();
    hosts.value = result.hosts;
    error.value = null;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

async function refreshControl() {
  try {
    controlStatus.value = await api.getRemoteControlStatus();
  } catch {
    controlStatus.value = null;
  }
}

async function toggleControl() {
  if (!controlStatus.value || controlBusy.value) return;
  controlBusy.value = true;
  try {
    const next = !controlStatus.value.enabled;
    controlStatus.value = await api.setRemoteControlEnabled(next);
    store.appState?.showToast(
      next
        ? t("settings.remoteHosts.controlRunning")
        : t("settings.remoteHosts.controlStopped"),
      { variant: "info" },
    );
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    store.appState?.showToast(message, { variant: "error" });
  } finally {
    controlBusy.value = false;
  }
}

async function regenerateToken() {
  if (controlBusy.value) return;
  controlBusy.value = true;
  try {
    controlStatus.value = await api.generateRemoteControlPairingToken();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    store.appState?.showToast(message, { variant: "error" });
  } finally {
    controlBusy.value = false;
  }
}

async function copyText(text: string | undefined, toastKey: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    store.appState?.showToast(t(`settings.remoteHosts.${toastKey}`), { variant: "info" });
  } catch {
    /* ignore clipboard failure */
  }
}

onMounted(() => {
  void refresh();
  void refreshControl();
});

async function submit() {
  const url = form.url.trim();
  const pairingToken = form.pairingToken.trim();
  const label = form.label.trim();
  if (!url || !pairingToken || !label) return;
  pairing.value = true;
  try {
    const result = await api.pairRemoteHost({ url, pairingToken, label });
    store.appState?.showToast(
      t("settings.remoteHosts.pairSucceeded", { label: result.host.label }),
      { variant: "info" },
    );
    Object.assign(form, EMPTY_FORM);
    await refresh();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    store.appState?.showToast(
      t("settings.remoteHosts.pairFailed", { message }),
      { variant: "error" },
    );
  } finally {
    pairing.value = false;
  }
}

async function remove(host: RemoteHostSummary) {
  removing.value = host.hostKey;
  try {
    await api.removeRemoteHost(host.hostKey);
    store.appState?.showToast(
      t("settings.remoteHosts.removed", { label: host.label }),
      { variant: "info" },
    );
    await refresh();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    store.appState?.showToast(
      t("settings.remoteHosts.removeFailed", { message }),
      { variant: "error" },
    );
  } finally {
    removing.value = null;
  }
}

// Switching back to a key drops the secret from the draft: it is only ever
// held while password mode is selected.
function selectSshAuth(auth: RemoteHostSshAuth) {
  sshForm.auth = auth;
  if (auth === "key") sshForm.password = "";
}

async function submitSsh() {
  const label = sshForm.label.trim();
  const host = sshForm.host.trim();
  if (!host || !label) return;
  const passwordMode = sshForm.auth === "password";
  // Never trimmed: leading and trailing spaces can be part of a password,
  // so emptiness is tested separately from the value that is sent.
  const password = sshForm.password;
  if (passwordMode && !password) return;
  const user = sshForm.user.trim();
  const port = sshForm.port.trim();
  const identityFile = sshForm.identityFile.trim();
  installing.value = true;
  try {
    // Empty optional fields are dropped rather than sent blank, so main
    // falls back to the SSH config and the local user name. A password
    // replaces the key, so no `-i` is sent alongside it.
    const result = await api.bootstrapRemoteHost({
      label,
      host,
      ...(user ? { user } : {}),
      ...(port ? { port: Number(port) } : {}),
      ...(!passwordMode && identityFile ? { identityFile } : {}),
      ...(passwordMode && password ? { password } : {}),
    });
    store.appState?.showToast(
      t("settings.remoteHosts.sshSucceeded", { label: result.host.label }),
      { variant: "info" },
    );
    // Drops the password with the rest of the draft.
    Object.assign(sshForm, EMPTY_SSH_FORM);
    await refresh();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    store.appState?.showToast(
      t("settings.remoteHosts.sshFailed", { message }),
      { variant: "error" },
    );
  } finally {
    installing.value = false;
  }
}

const busy = computed(() => installing.value || pairing.value);
const sshSubmitDisabled = computed(
  () =>
    installing.value ||
    !sshForm.host.trim() ||
    !sshForm.label.trim() ||
    (sshForm.auth === "password" && sshForm.password === ""),
);
const pairSubmitDisabled = computed(
  () => pairing.value || !form.url.trim() || !form.pairingToken.trim() || !form.label.trim(),
);
</script>

<template>
  <div class="settings-stack">
    <div
      class="settings-remote-host-list"
      role="list"
      :aria-busy="hosts === null || removing !== null"
    >
      <div v-if="error" class="settings-remote-host-empty" role="alert">
        {{ t("settings.remoteHosts.listError") }}
        <span class="settings-remote-host-empty-detail">{{ error }}</span>
      </div>
      <div v-else-if="hosts === null" class="settings-remote-host-empty" role="status">
        {{ t("settings.remoteHosts.loading") }}
      </div>
      <div v-else-if="hosts.length === 0" class="settings-remote-host-empty" role="status">
        {{ t("settings.remoteHosts.empty") }}
      </div>
      <template v-else>
        <article
          v-for="host in hosts"
          :key="host.hostKey"
          class="settings-remote-host-card"
          role="listitem"
        >
          <span
            class="settings-remote-host-pulse"
            :class="{ 'is-online': host.connected }"
            aria-hidden="true"
          />
          <div class="settings-remote-host-copy">
            <div class="settings-remote-host-name">{{ host.label }}</div>
            <div class="settings-remote-host-meta">
              {{
                host.transport === "ssh"
                  ? `${t("settings.remoteHosts.transportSsh")} · ${host.url}`
                  : host.url
              }}
            </div>
          </div>
          <span class="settings-remote-host-card-actions">
            <Badge :tone="host.connected ? 'success' : 'neutral'">
              {{
                host.connected
                  ? t("settings.remoteHosts.statusOnline")
                  : t("settings.remoteHosts.statusOffline")
              }}
            </Badge>
            <Button
              variant="ghost"
              type="button"
              :disabled="removing === host.hostKey"
              @click="void remove(host)"
            >
              {{
                removing === host.hostKey
                  ? t("settings.remoteHosts.removing")
                  : t("settings.remoteHosts.remove")
              }}
            </Button>
          </span>
        </article>
      </template>
    </div>

    <section class="settings-card-block">
      <div class="settings-card-heading-row settings-remote-host-add-heading">
        <h3 class="settings-card-heading">{{ t("settings.remoteHosts.addTitle") }}</h3>
        <div
          class="settings-segment"
          role="tablist"
          :aria-label="t('settings.remoteHosts.addTitle')"
        >
          <button
            v-for="mode in (['ssh', 'pair'] as const)"
            :key="mode"
            type="button"
            role="tab"
            :id="`remote-host-add-${mode}`"
            :aria-selected="addMode === mode"
            :aria-controls="`remote-host-add-panel-${mode}`"
            class="settings-segment-item"
            :class="{ active: addMode === mode }"
            :disabled="busy"
            @click="addMode = mode"
          >
            {{
              mode === "ssh"
                ? t("settings.remoteHosts.addSsh")
                : t("settings.remoteHosts.addPair")
            }}
          </button>
        </div>
      </div>
      <div class="settings-panel">
        <form
          id="remote-host-add-panel-ssh"
          role="tabpanel"
          aria-labelledby="remote-host-add-ssh"
          :hidden="addMode !== 'ssh'"
          class="settings-remote-host-form settings-remote-host-add-panel"
          @submit.prevent="submitSsh"
        >
          <div class="settings-remote-host-form-row">
            <Field :label="t('settings.remoteHosts.fieldLabel')">
              <Input
                :value="sshForm.label"
                :placeholder="t('settings.remoteHosts.fieldLabelPlaceholder')"
                :aria-label="t('settings.remoteHosts.fieldLabel')"
                autocomplete="off"
                :spellcheck="false"
                :disabled="installing"
                @input="sshForm.label = fieldValue($event)"
              />
            </Field>
            <Field :label="t('settings.remoteHosts.sshHost')">
              <Input
                :value="sshForm.host"
                :placeholder="t('settings.remoteHosts.sshHostPlaceholder')"
                :aria-label="t('settings.remoteHosts.sshHost')"
                autocomplete="off"
                autocapitalize="off"
                :spellcheck="false"
                :disabled="installing"
                @input="sshForm.host = fieldValue($event)"
              />
            </Field>
          </div>

          <div class="settings-remote-host-form-row is-narrow-port">
            <Field :label="t('settings.remoteHosts.sshUser')">
              <Input
                :value="sshForm.user"
                :aria-label="t('settings.remoteHosts.sshUser')"
                autocomplete="off"
                autocapitalize="off"
                :spellcheck="false"
                :disabled="installing"
                @input="sshForm.user = fieldValue($event)"
              />
            </Field>
            <Field :label="t('settings.remoteHosts.sshPort')">
              <Input
                :value="sshForm.port"
                :aria-label="t('settings.remoteHosts.sshPort')"
                inputmode="numeric"
                autocomplete="off"
                :spellcheck="false"
                :disabled="installing"
                @input="sshForm.port = fieldValue($event)"
              />
            </Field>
          </div>

          <div class="settings-remote-host-form-auth">
            <div class="text-sm text-text-secondary" id="settings-remote-host-auth-label">
              {{ t("settings.remoteHosts.sshAuthMode") }}
            </div>
            <div
              class="settings-segment"
              role="radiogroup"
              aria-labelledby="settings-remote-host-auth-label"
            >
              <button
                v-for="auth in (['key', 'password'] as const)"
                :key="auth"
                type="button"
                role="radio"
                class="settings-segment-item"
                :class="{ active: sshForm.auth === auth }"
                :aria-checked="sshForm.auth === auth"
                :aria-pressed="sshForm.auth === auth"
                :disabled="installing"
                @click="selectSshAuth(auth)"
              >
                {{
                  auth === "key"
                    ? t("settings.remoteHosts.sshAuthKey")
                    : t("settings.remoteHosts.sshAuthPassword")
                }}
              </button>
            </div>
          </div>

          <Field
            v-if="sshForm.auth === 'key'"
            :label="t('settings.remoteHosts.sshIdentityFile')"
          >
            <Input
              :value="sshForm.identityFile"
              :aria-label="t('settings.remoteHosts.sshIdentityFile')"
              autocomplete="off"
              autocapitalize="off"
              :spellcheck="false"
              :disabled="installing"
              @input="sshForm.identityFile = fieldValue($event)"
            />
          </Field>
          <Field v-else :label="t('settings.remoteHosts.sshPassword')">
            <PasswordInput
              :value="sshForm.password"
              :placeholder="t('settings.remoteHosts.sshPasswordPlaceholder')"
              :aria-label="t('settings.remoteHosts.sshPassword')"
              autocomplete="off"
              :spellcheck="false"
              :disabled="installing"
              :show-label="t('settings.remoteHosts.sshShowPassword')"
              :hide-label="t('settings.remoteHosts.sshHidePassword')"
              @input="sshForm.password = fieldValue($event)"
            />
          </Field>

          <div class="settings-remote-host-form-actions">
            <Button type="submit" variant="primary" :disabled="sshSubmitDisabled">
              {{
                installing
                  ? t("settings.remoteHosts.sshRunning")
                  : t("settings.remoteHosts.sshAction")
              }}
            </Button>
          </div>
        </form>

        <form
          id="remote-host-add-panel-pair"
          role="tabpanel"
          aria-labelledby="remote-host-add-pair"
          :hidden="addMode !== 'pair'"
          class="settings-remote-host-form settings-remote-host-add-panel"
          @submit.prevent="submit"
        >
          <div class="settings-remote-host-form-row">
            <Field :label="t('settings.remoteHosts.fieldLabel')">
              <Input
                :value="form.label"
                :placeholder="t('settings.remoteHosts.fieldLabelPlaceholder')"
                :aria-label="t('settings.remoteHosts.fieldLabel')"
                autocomplete="off"
                :spellcheck="false"
                :disabled="pairing"
                @input="form.label = fieldValue($event)"
              />
            </Field>
            <Field :label="t('settings.remoteHosts.fieldUrl')">
              <Input
                :value="form.url"
                :placeholder="t('settings.remoteHosts.fieldUrlPlaceholder')"
                :aria-label="t('settings.remoteHosts.fieldUrl')"
                inputmode="url"
                autocomplete="off"
                autocapitalize="off"
                :spellcheck="false"
                :disabled="pairing"
                @input="form.url = fieldValue($event)"
              />
            </Field>
          </div>
          <Field :label="t('settings.remoteHosts.fieldPairingToken')">
            <Input
              :value="form.pairingToken"
              :placeholder="t('settings.remoteHosts.fieldPairingTokenPlaceholder')"
              :aria-label="t('settings.remoteHosts.fieldPairingToken')"
              autocomplete="off"
              autocapitalize="off"
              :spellcheck="false"
              type="password"
              :disabled="pairing"
              @input="form.pairingToken = fieldValue($event)"
            />
          </Field>
          <div class="settings-remote-host-form-actions">
            <Button type="submit" variant="primary" :disabled="pairSubmitDisabled">
              {{
                pairing
                  ? t("settings.remoteHosts.pairing")
                  : t("settings.remoteHosts.pair")
              }}
            </Button>
          </div>
        </form>
      </div>
    </section>

    <!-- Local Remote Control Host Service -->
    <section class="settings-card-block">
      <div class="settings-card-heading-row settings-remote-host-control-heading">
        <div class="settings-card-heading-help">
          <h3 class="settings-card-heading">{{ t("settings.remoteHosts.controlTitle") }}</h3>
          <HelpIcon :label="t('settings.remoteHosts.controlDesc')" />
        </div>
        <button
          type="button"
          class="settings-toggle"
          :class="{ on: controlStatus?.enabled, 'is-busy': controlBusy }"
          role="switch"
          :aria-checked="controlStatus?.enabled"
          :aria-label="t('settings.remoteHosts.controlEnable')"
          :disabled="controlBusy || !controlStatus"
          @click="void toggleControl()"
        >
          <span class="settings-toggle-thumb" />
        </button>
      </div>

      <div v-if="controlStatus?.enabled" class="settings-panel">
        <div class="settings-remote-control-panel">
          <div class="settings-remote-control-grid">
            <div class="settings-remote-control-item">
              <span class="settings-remote-control-label">{{ t("settings.remoteHosts.controlStatus") }}</span>
              <div class="settings-remote-control-val">
                <Badge tone="success">{{ t("settings.remoteHosts.controlRunning") }}</Badge>
                <span class="settings-remote-control-meta">
                  {{ t("settings.remoteHosts.controlPort") }}: {{ controlStatus.port }} · {{ controlStatus.connectedClients }} {{ t("settings.remoteHosts.controlConnectedClients") }}
                </span>
              </div>
            </div>

            <div v-if="controlStatus.localAddresses?.length" class="settings-remote-control-item">
              <span class="settings-remote-control-label">{{ t("settings.remoteHosts.controlAddresses") }}</span>
              <div class="settings-remote-control-addrs">
                <code v-for="addr in controlStatus.localAddresses" :key="addr" class="settings-remote-control-code">
                  {{ addr }}
                </code>
              </div>
            </div>

            <div v-if="controlStatus.pairingToken" class="settings-remote-control-item">
              <span class="settings-remote-control-label">{{ t("settings.remoteHosts.controlPairingToken") }}</span>
              <div class="settings-remote-control-row">
                <code class="settings-remote-control-code">{{ controlStatus.pairingToken }}</code>
                <div class="settings-remote-control-actions">
                  <Button variant="ghost" size="sm" type="button" @click="void copyText(controlStatus?.pairingToken, 'controlTokenCopied')">
                    {{ t("settings.remoteHosts.controlCopyToken") }}
                  </Button>
                  <Button variant="ghost" size="sm" type="button" :disabled="controlBusy" @click="void regenerateToken()">
                    {{ t("settings.remoteHosts.controlRegenerateToken") }}
                  </Button>
                </div>
              </div>
            </div>

            <div v-if="controlStatus.pairingUrl" class="settings-remote-control-item">
              <span class="settings-remote-control-label">{{ t("settings.remoteHosts.controlPairingUrl") }}</span>
              <div class="settings-remote-control-row">
                <code class="settings-remote-control-code">{{ controlStatus.pairingUrl }}</code>
                <div class="settings-remote-control-actions">
                  <Button variant="ghost" size="sm" type="button" @click="void copyText(controlStatus?.pairingUrl, 'controlUrlCopied')">
                    {{ t("settings.remoteHosts.controlCopyUrl") }}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
