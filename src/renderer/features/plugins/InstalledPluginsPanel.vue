<script setup lang="ts">
/**
 * The installed index: every plugin the host knows about, grouped by what needs
 * a decision first, each row carrying its own scope, settings and row menu.
 *
 * The `InstalledPluginsPanel` component. The choices
 * that are not mechanical:
 *
 *   1. **`{...page}` is one `page` prop.** A Vue template cannot spread an
 *      object into props, and the model has ~40 members; the panel destructures
 *      the ~20 it renders from `props.page`. See `pages/PluginsPage.vue` for why
 *      the panel does not call `usePluginsPage()` itself — briefly, the
 *      composable owns the mount effects, so a second call would duplicate the
 *      loads and subscribe twice.
 *   2. **`cx("a", cond && "b")` is a static `class` plus an object `:class`.**
 *      The class-name contract reads object keys and a `cx` call in a template
 *      would need a script helper for no gain; the object binding also keeps
 *      `off` / `broken` / `menu-open` visible to the contract.
 *   3. **`AnchoredMenu`'s `trigger(ref)` render prop is its `#trigger` scoped
 *      slot** (`setAnchor` is the function ref), and `TooltipButton`'s
 *      `tooltip` prop is this tree's `label`. Every `TooltipButton`
 *      renders a `<button>`, so `as="button"` is stated explicitly.
 *   4. **`ScopeControl`'s `onSetEnabled` / `onSetScope` are `set-enabled` /
 *      `set-scope` emits**, and `TooltipButton`'s `ariaLabel` prop is written
 *      as `:aria-label` — Vue camelizes that onto the declared prop, which is
 *      what the shared component reads.
 *   5. **The two `<>` fragments become `<template>` wrappers.** The row menu's
 *      separator plus uninstall button is one, and the whole conditional body
 *      is not: `v-if` / `v-else-if` / `v-else` on sibling elements is the same
 *      three-way choice.
 *   6. **`store` is not read here.** The scope writes go through `run` and
 *      `refreshPlugins` from the model, in the same way.
 */
import { useI18n } from "vue-i18n";
import type { ActivationScope } from "@dcode/shared";
import { api } from "../../lib/api";
import {
  IconCircleAlert,
  IconMore,
  IconPanel,
  IconPlug,
  IconReview,
  IconSearch,
  IconSettings,
  IconTrash,
} from "../../lib/icons";
import Button from "../../components/ui/Button.vue";
import TooltipButton from "../../components/TooltipButton.vue";
import AnchoredMenu from "../../components/settings/AnchoredMenu.vue";
import ScopeControl from "../../components/extensions/ScopeControl.vue";
import PluginRowDetails from "./PluginRowDetails.vue";
import { GROUP_LABEL_KEYS, TEMPLATE_IDS } from "./model";
import type { PluginsPageModel } from "./usePluginsPage";

const props = defineProps<{ page: PluginsPageModel }>();

/** `t` is taken from the page model, so the whole surface shares one translator. */
const { t } = useI18n();

const {
  plugins,
  loadDev,
  setTemplatePick,
  installedGroups,
  setInstalledQuery,
  rowMenu,
  setRowMenu,
  busyId,
  projects,
  currentProjectPath,
  run,
  refreshPlugins,
  reloadingId,
  reloadPlugin,
  setSettingsPlugin,
  servicesByPlugin,
} = props.page;

/**
 * A row's scope write: the API call first, the
 * plugin list re-read after it, and `run` reporting whatever the host refuses.
 */
function setEnabled(pluginId: string, enabled: boolean): void {
  void run(async () => {
    if (enabled) await api.enablePlugin(pluginId);
    else await api.disablePlugin(pluginId);
    await refreshPlugins();
  });
}

function setScope(pluginId: string, scope: ActivationScope): void {
  void run(async () => {
    await api.setPluginScope(pluginId, scope);
    await refreshPlugins();
  });
}
</script>

<template>
  <div class="plugins-panel">
    <div v-if="plugins.length === 0" class="plugins-empty">
      <span class="plugins-empty-icon" aria-hidden="true">
        <IconPlug :size="18" />
      </span>
      <p class="plugins-empty-title">{{ t("plugins.empty") }}</p>
      <div class="plugins-empty-actions">
        <Button variant="primary" @click="void loadDev()">
          {{ t("plugins.loadDev") }}
        </Button>
        <Button variant="secondary" @click="setTemplatePick(TEMPLATE_IDS[0])">
          {{ t("plugins.newFromTemplate") }}
        </Button>
      </div>
    </div>
    <div v-else-if="installedGroups.length === 0" class="plugins-empty">
      <span class="plugins-empty-icon" aria-hidden="true">
        <IconSearch :size="18" />
      </span>
      <p class="plugins-empty-title">{{ t("plugins.noMatches") }}</p>
      <div class="plugins-empty-actions">
        <Button variant="secondary" @click="setInstalledQuery('')">
          {{ t("plugins.clearSearch") }}
        </Button>
      </div>
    </div>
    <template v-else>
      <section v-for="group in installedGroups" :key="group.id" class="plugins-group">
        <header class="plugins-group-head">
          <h2 class="plugins-group-label">{{ t(GROUP_LABEL_KEYS[group.id]) }}</h2>
          <span class="plugins-group-count">{{ group.rows.length }}</span>
        </header>
        <div
          class="plugins-list"
          role="list"
          :aria-label="t(GROUP_LABEL_KEYS[group.id])"
        >
          <div
            v-for="plugin in group.rows"
            :key="plugin.id"
            role="listitem"
            class="plugins-row"
            :class="{
              off: !plugin.enabled,
              broken: group.id === 'attention',
              'menu-open': rowMenu === plugin.id,
            }"
          >
            <span class="plugins-glyph" aria-hidden="true">
              <IconCircleAlert v-if="group.id === 'attention'" :size="15" />
              <IconPlug v-else :size="15" />
            </span>
            <div class="plugins-row-copy">
              <div class="plugins-row-title">
                <span class="plugins-row-name">{{ plugin.name }}</span>
                <span v-if="plugin.source === 'dev'" class="plugins-tag">
                  {{ t("plugins.tagLocal") }}
                </span>
                <span v-if="plugin.bundled" class="plugins-tag">
                  {{ t("plugins.tagBundled") }}
                </span>
              </div>
              <div class="plugins-row-meta">
                <span class="plugins-row-id">{{ plugin.id }}</span>
                <span class="plugins-dot" aria-hidden="true">·</span>
                <span>v{{ plugin.version }}</span>
              </div>
              <p v-if="plugin.errorMessage" class="plugins-row-error">
                {{ plugin.errorMessage }}
              </p>
              <PluginRowDetails
                :plugin="plugin"
                :services="servicesByPlugin.get(plugin.id)"
              />
            </div>
            <div class="plugins-row-controls">
              <ScopeControl
                :target="plugin"
                :label="plugin.name"
                compact
                :projects="projects"
                :current-project-path="currentProjectPath"
                @set-enabled="setEnabled(plugin.id, $event)"
                @set-scope="setScope(plugin.id, $event)"
              />
              <div class="plugins-row-actions">
                <TooltipButton
                  v-if="plugin.ui?.panel"
                  as="button"
                  type="button"
                  class="plugins-icon-btn"
                  :label="t('plugins.openPanel')"
                  :aria-label="t('plugins.openPanel')"
                  @click="void run(() => api.openPluginPanel(plugin.id))"
                >
                  <IconPanel :size="15" />
                </TooltipButton>
                <TooltipButton
                  v-if="plugin.enabled && plugin.settings?.length"
                  as="button"
                  type="button"
                  class="plugins-icon-btn"
                  :label="t('plugins.openSettings')"
                  :aria-label="t('plugins.openSettings')"
                  @click="setSettingsPlugin(plugin)"
                >
                  <IconSettings :size="15" />
                </TooltipButton>
                <AnchoredMenu
                  class="plugins-menu-wrap"
                  :open="rowMenu === plugin.id"
                  menu-class-name="plugins-menu is-end"
                  :label="t('plugins.rowActions', { name: plugin.name })"
                  role="menu"
                  align="end"
                  @close="setRowMenu(null)"
                >
                  <template #trigger="{ setAnchor }">
                    <TooltipButton
                      :ref="setAnchor"
                      as="button"
                      type="button"
                      class="plugins-icon-btn"
                      :label="t('plugins.rowActions', { name: plugin.name })"
                      :aria-label="t('plugins.rowActions', { name: plugin.name })"
                      aria-haspopup="menu"
                      :aria-expanded="rowMenu === plugin.id"
                      @click="setRowMenu((cur) => (cur === plugin.id ? null : plugin.id))"
                    >
                      <IconMore :size="15" />
                    </TooltipButton>
                  </template>
                  <button
                    v-if="plugin.source === 'dev'"
                    type="button"
                    role="menuitem"
                    :disabled="busyId === plugin.id || reloadingId === plugin.id"
                    @click="
                      setRowMenu(null);
                      void reloadPlugin(plugin.id);
                    "
                  >
                    <IconReview :size="14" />
                    {{ t("plugins.reload") }}
                  </button>
                  <template v-if="!plugin.bundled">
                    <div class="plugins-menu-sep" />
                    <button
                      type="button"
                      role="menuitem"
                      class="danger"
                      @click="
                        setRowMenu(null);
                        void run(async () => {
                          await api.uninstallPlugin(plugin.id);
                          await refreshPlugins();
                        });
                      "
                    >
                      <IconTrash :size="14" />
                      {{ t("plugins.uninstall") }}
                    </button>
                  </template>
                </AnchoredMenu>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
