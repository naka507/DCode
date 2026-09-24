<script setup lang="ts">
/**
 * The Extensions destination: what is installed here.
 *
 * The `PluginsPage` component. The choices that are not mechanical:
 *
 *   1. **`<InstalledPluginsPanel {...page} />` becomes one `page` prop.** A Vue
 *      template cannot spread an object into props, and the model has ~40
 *      members, so every panel takes the whole model as `page` and destructures
 *      what it renders — the shape `usePluginsPage`'s own header already
 *      documents. Letting each panel call `usePluginsPage()` itself would be
 *      wrong rather than merely different: the composable owns mount effects
 *      (the project list and the plugin-service subscription), so a second call
 *      would re-issue those loads and subscribe twice.
 * 2. **`t` comes from the model rather than a second `useI18n()`.** The page
 *      destructures `t` out of `page`; keeping that means one translation
 *      function for the page and every panel below it.
 *   3. **`AnchoredMenu`'s `trigger(ref)` render prop is its `#trigger` scoped
 *      slot**, which hands the caller `setAnchor` (see `AnchoredMenu.vue`), and
 *      `TooltipButton`'s `tooltip` prop is the `label` used here. A
 *      `<button>` is rendered, so `as="button"` is stated explicitly.
 *   4. **`cx("a", cond && "b")` is a static `class` plus an object `:class`.**
 *      The class-name contract reads object keys, and a template literal's
 *      glued fragment would be reported as an invented class.
 *   5. **Bare `aria-hidden` is written `aria-hidden="true"`**: a bare Vue
 *      attribute renders `""`, so the explicit value is written.
 *
 * The overlays this page owns are rendered by `PluginDialogs` in place: that
 * file never portaled them, and `styles/plugins.css` positions the layer
 * itself. The layer deliberately stacks *inside* the route surface — see the
 * note in `tests/plugins-page-style.test.mjs` — so teleporting it would move it
 * out from under the titlebar band it reserves room for.
 */
import { usePluginsPage } from "../features/plugins/usePluginsPage";
import TooltipButton from "../components/TooltipButton.vue";
import AnchoredMenu from "../components/settings/AnchoredMenu.vue";
import { IconMore, IconPlug } from "../lib/icons";
import SearchField from "../features/plugins/SearchField.vue";
import InstalledPluginsPanel from "../features/plugins/InstalledPluginsPanel.vue";
import PluginDialogs from "../features/plugins/PluginDialogs.vue";

/** See note 1. The page creates the model; the panels render out of it. */
const page = usePluginsPage();
const {
  t,
  headerMenu,
  setHeaderMenu,
  overflowActions,
  plugins,
  installedQuery,
  filteredInstalled,
  setInstalledQuery,
} = page;
</script>

<template>
  <div class="thread-scroll">
    <div class="page-frame plugins-page">
      <div class="page-header plugins-page-header">
        <div class="plugins-title-block">
          <span class="plugins-title-icon" aria-hidden="true">
            <IconPlug :size="14" />
          </span>
          <div class="plugins-title-copy">
            <h1 class="page-title">{{ t("plugins.title") }}</h1>
          </div>
        </div>
        <div class="plugins-header-actions">
          <AnchoredMenu
            class="plugins-menu-wrap"
            :open="headerMenu"
            menu-class-name="plugins-menu is-end"
            :label="t('plugins.moreActions')"
            role="menu"
            align="end"
            @close="setHeaderMenu(false)"
          >
            <template #trigger="{ setAnchor }">
              <TooltipButton
                :ref="setAnchor"
                as="button"
                type="button"
                class="plugins-icon-btn plugins-header-menu"
                :aria-label="t('plugins.moreActions')"
                :label="t('plugins.moreActions')"
                aria-haspopup="menu"
                :aria-expanded="headerMenu"
                @click="setHeaderMenu((open) => !open)"
              >
                <IconMore :size="16" />
              </TooltipButton>
            </template>
            <button
              v-for="action in overflowActions"
              :key="action.key"
              type="button"
              role="menuitem"
              :data-action="action.key"
              @click="
                setHeaderMenu(false);
                void action.run();
              "
            >
              {{ t(`plugins.${action.key}`) }}
            </button>
          </AnchoredMenu>
        </div>
      </div>

      <div class="plugins-toolbar">
        <div v-if="plugins.length" class="plugins-toolbar-end">
          <span v-if="installedQuery.trim()" class="plugins-result-count" aria-live="polite">
            {{
              t("plugins.resultCount", {
                count: filteredInstalled.length,
                total: plugins.length,
              })
            }}
          </span>
          <SearchField
            :value="installedQuery"
            :placeholder="t('plugins.searchInstalled')"
            @change="setInstalledQuery"
          />
        </div>
      </div>

      <InstalledPluginsPanel :page="page" />
    </div>

    <PluginDialogs :page="page" />
  </div>
</template>
