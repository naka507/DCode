<script setup lang="ts">
/**
 * Every overlay the Extensions page can raise: the development permission
 * review, the plugin settings sheet and the template picker.
 *
 * The `PluginDialogs` component. The choices that are
 * not mechanical:
 *
 *   1. **`{...page}` is one `page` prop.** A Vue template cannot spread an
 *      object into props; see `pages/PluginsPage.vue` for why this file does not
 *      call `usePluginsPage()` itself. Every dialog here is driven by a model ref
 *      (`pendingReview`, `settingsPlugin`, `templatePick`), so a second call
 *      would raise dialogs nobody can see.
 *   2. **The `onSaved` that re-read the store is a plain `refreshPlugins` +
 *      `plugins` lookup.** `useAppStore.getState()` is deliberately
 *      absent from this store's surface, so the settings sheet's save handler
 *      reads the tracked `plugins` model projection after the refresh, which is
 *      the same value the commit just wrote.
 *   3. **`onXxx` props on the child component are emits**: the settings sheet
 *      listens with `@close` / `@saved`.
 *   4. **The local `PermissionGroups` is inlined into the template.** An SFC
 *      holds one component; its two branches are `v-if="!permissions.length"`
 *      and `v-for` over `RISK_TIERS`, with the risk-group modifier spelled as
 *      an object of literal names because a template literal's glued `risk-`
 *      fragment is reported by the class-name contract as an invented class.
 *   5. **`cx("a", cond && "b")` is a static `class` plus an object `:class`**,
 *      and bare `aria-hidden` is written `aria-hidden="true"`.
 *   6. **`platform` is read from the preload bridge here**, as
 *      `window.dcode?.platform` in this same component.
 */
import { useI18n } from "vue-i18n";
import Button from "../../components/ui/Button.vue";
import PluginSettingsSheet from "../../components/plugins/PluginSettingsSheet.vue";
import {
  IconCheck,
  IconShield,
  IconSparkles,
  IconTriangleAlert,
} from "../../lib/icons";
import {
  RISK_LABEL_KEYS,
  RISK_TIERS,
  TEMPLATE_IDS,
  permissionLabel,
  permissionRisk,
} from "./model";
import type { PluginsPageModel } from "./usePluginsPage";

const props = defineProps<{ page: PluginsPageModel }>();

const { t } = useI18n();

const {
  pendingReview,
  setPendingReview,
  confirmReview,
  busyId,
  settingsPlugin,
  setSettingsPlugin,
  refreshPlugins,
  plugins,
  templatePick,
  creating,
  setTemplatePick,
  createFromTemplate,
} = props.page;

/**
 * The platform a shortcut is displayed for. Read once at setup: the bridge's
 * platform is fixed for the window's life, and the template cannot reach
 * `window` directly (Vue compiles an unknown global as a component binding).
 */
const platform = (window.dcode?.platform ?? "darwin") as
  | "darwin"
  | "win32"
  | "linux";
/**
 * The settings sheet's `onSaved`: re-read the plugin list, then hand the sheet
 * the refreshed record so it keeps editing the row the host just wrote.
 */
async function settingsSaved(): Promise<void> {
  await refreshPlugins();
  const updated = plugins.value.find((plugin) => plugin.id === settingsPlugin.value?.id);
  if (updated) setSettingsPlugin(updated);
}

/** The permissions of one risk tier, or an empty list when none are declared. */
function permissionsAtRisk(permissions: string[], tier: (typeof RISK_TIERS)[number]) {
  return permissions.filter((permission) => permissionRisk(permission) === tier);
}
</script>

<template>
  <div v-if="pendingReview" class="plugins-modal-backdrop" role="presentation">
    <div
      class="plugins-modal"
      role="dialog"
      aria-modal="true"
      :aria-label="t('plugins.permissionReview')"
    >
      <header class="plugins-modal-head">
        <span class="plugins-modal-icon" aria-hidden="true">
          <IconShield :size="17" />
        </span>
        <div>
          <h2 class="plugins-modal-title">
            {{
              t(
                pendingReview.kind === "reload"
                  ? "plugins.devReviewNewTitle"
                  : "plugins.devReviewTitle",
                { name: pendingReview.name },
              )
            }}
          </h2>
          <p v-if="pendingReview.version" class="plugins-modal-subtitle">
            {{ t("plugins.installingVersion", { version: pendingReview.version }) }}
          </p>
        </div>
      </header>

      <div class="plugins-modal-body">
        <p class="plugins-modal-lede">{{ t("plugins.devReviewBody") }}</p>
        <p v-if="!pendingReview.permissions.length" class="plugins-modal-lede">
          {{ t("plugins.noPermissions") }}
        </p>
        <template v-else>
          <template v-for="tier in RISK_TIERS" :key="tier">
            <div
              v-if="permissionsAtRisk(pendingReview.permissions, tier).length"
              class="plugins-risk-group"
              :class="{
                'risk-high': tier === 'high',
                'risk-medium': tier === 'medium',
                'risk-low': tier === 'low',
              }"
            >
            <div class="plugins-risk-head">
              <IconTriangleAlert v-if="tier === 'high'" :size="13" />
              <IconShield v-else :size="13" />
              {{ t(RISK_LABEL_KEYS[tier]) }}
              <span class="plugins-risk-count">
                {{ permissionsAtRisk(pendingReview.permissions, tier).length }}
              </span>
            </div>
            <ul class="plugins-perm-list is-plain">
              <li
                v-for="permission in permissionsAtRisk(pendingReview.permissions, tier)"
                :key="permission"
              >
                <span class="plugins-perm-copy">
                  <strong>
                    {{ permissionLabel(permission, t) }}
                    <span
                      v-if="pendingReview.addedPermissions.includes(permission)"
                      class="plugins-tag is-update"
                    >
                      {{ t("plugins.newPermission") }}
                    </span>
                  </strong>
                  <span>{{ t(`plugins.permissionHelp.${permission}`) }}</span>
                </span>
              </li>
            </ul>
            </div>
          </template>
        </template>
      </div>

      <div class="plugins-modal-actions">
        <Button variant="secondary" @click="setPendingReview(null)">
          {{ t("plugins.cancel") }}
        </Button>
        <Button
          variant="primary"
          :disabled="busyId === pendingReview.id"
          @click="void confirmReview()"
        >
          {{
            busyId === pendingReview.id
              ? t("plugins.devReviewLoading")
              : t("plugins.devReviewAccept")
          }}
        </Button>
      </div>
    </div>
  </div>

  <PluginSettingsSheet
    v-if="settingsPlugin"
    :plugin="settingsPlugin"
    :platform="platform"
    @close="setSettingsPlugin(null)"
    @saved="void settingsSaved()"
  />

  <div v-if="templatePick" class="plugins-modal-backdrop" role="presentation">
    <div
      class="plugins-modal"
      role="dialog"
      aria-modal="true"
      :aria-label="t('plugins.newFromTemplateTitle')"
    >
      <header class="plugins-modal-head">
        <span class="plugins-modal-icon" aria-hidden="true">
          <IconSparkles :size="17" />
        </span>
        <div>
          <h2 class="plugins-modal-title">{{ t("plugins.newFromTemplateTitle") }}</h2>
        </div>
      </header>

      <div class="plugins-modal-body">
        <div
          class="plugins-template-list"
          role="radiogroup"
          :aria-label="t('plugins.newFromTemplateTitle')"
        >
          <button
            v-for="template in TEMPLATE_IDS"
            :key="template"
            type="button"
            role="radio"
            :aria-checked="templatePick === template"
            class="plugins-template"
            :class="{ active: templatePick === template }"
            @click="setTemplatePick(template)"
          >
            <span class="plugins-template-mark" aria-hidden="true">
              <IconCheck v-if="templatePick === template" :size="13" />
            </span>
            <span class="plugins-template-copy">
              <strong class="plugins-template-name">
                {{ t(`plugins.templateName.${template}`) }}
              </strong>
              <span class="plugins-template-body">
                {{ t(`plugins.templateBody.${template}`) }}
              </span>
            </span>
          </button>
        </div>
      </div>

      <div class="plugins-modal-actions">
        <Button
          variant="secondary"
          data-action="cancel"
          :disabled="creating"
          @click="setTemplatePick(null)"
        >
          {{ t("plugins.cancel") }}
        </Button>
        <Button
          variant="primary"
          :disabled="creating"
          @click="void createFromTemplate(templatePick)"
        >
          {{
            creating
              ? t("plugins.newFromTemplateCreating")
              : t("plugins.newFromTemplateCreate")
          }}
        </Button>
      </div>
    </div>
  </div>
</template>
