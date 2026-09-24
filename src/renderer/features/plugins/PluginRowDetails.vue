<script setup lang="ts">
/**
 * Keep the installed row calm while retaining the full capability readout on
 * demand.
 *
 * The `PluginRowDetails` component. The five child components are
 * the sibling `.vue` files this module was split into; they are imported
 * from the same `presentation` module.
 *
 * `IconChevronDown`'s `aria-hidden` is written explicitly as `"true"`,
 * because a bare Vue attribute renders as `""`, which is a different
 * attribute value.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { PluginServiceStatus, PluginSummary } from "@dcode/shared";
import { IconChevronDown } from "../../lib/icons";
import { FS_MODES, LEGACY_FS_PERMISSIONS } from "./model";
import AgentExtensionDetails from "./AgentExtensionDetails.vue";
import CapabilityChips from "./CapabilityChips.vue";
import FsScopeChips from "./FsScopeChips.vue";
import PermissionChips from "./PermissionChips.vue";
import ServiceChips from "./ServiceChips.vue";

const props = defineProps<{
  plugin: PluginSummary;
  services: readonly PluginServiceStatus[] | undefined;
}>();

const { t } = useI18n();

const hasCapabilities = computed(() => (props.plugin.capabilities?.length ?? 0) > 0);
const hasServices = computed(() => (props.services?.length ?? 0) > 0);
const hasPermissions = computed(() => (props.plugin.permissions?.length ?? 0) > 0);
const hasAgentExtension = computed(() => props.plugin.agentExtension !== undefined);
const hasFsScope = computed(() => FS_MODES.some((mode) => props.plugin.fs?.[mode]));
const legacyFs = computed(() =>
  (props.plugin.permissions ?? []).filter((permission) =>
    LEGACY_FS_PERMISSIONS.includes(permission),
  ),
);

/** The four-way early return: nothing to say, nothing to render. */
const visible = computed(
  () =>
    hasCapabilities.value ||
    hasServices.value ||
    hasPermissions.value ||
    hasAgentExtension.value,
);
</script>

<template>
  <details v-if="visible" class="plugins-row-details">
    <summary
      class="plugins-row-details-toggle"
      :aria-label="t('plugins.viewDetailsOf', { name: plugin.name })"
    >
      <IconChevronDown :size="13" aria-hidden="true" />
      <span>{{ t("plugins.details") }}</span>
    </summary>
    <div class="plugins-row-details-body">
      <div v-if="hasCapabilities" class="plugins-row-detail">
        <span class="plugins-row-detail-label">{{
          t("plugins.capabilitiesTitle")
        }}</span>
        <CapabilityChips :capabilities="plugin.capabilities" />
      </div>
      <div v-if="hasServices" class="plugins-row-detail">
        <span class="plugins-row-detail-label">{{ t("plugins.servicesTitle") }}</span>
        <ServiceChips :statuses="services" />
      </div>
      <div v-if="hasAgentExtension && plugin.agentExtension" class="plugins-row-detail">
        <span class="plugins-row-detail-label">{{
          t("plugins.agentExtension.title")
        }}</span>
        <AgentExtensionDetails :status="plugin.agentExtension" />
      </div>
      <div v-if="hasPermissions" class="plugins-row-detail">
        <span class="plugins-row-detail-label">{{
          t("plugins.permissionsTitle")
        }}</span>
        <PermissionChips :permissions="plugin.permissions" />
      </div>
      <div v-if="hasFsScope" class="plugins-row-detail">
        <span class="plugins-row-detail-label">{{
          t("plugins.fileAccessTitle")
        }}</span>
        <FsScopeChips :policy="plugin.fs" />
      </div>
      <!--
        The plugin still loads, with less reach than its author expected.
        Saying so is the difference between "broken" and "needs an update".
      -->
      <p v-if="legacyFs.length" class="plugins-row-detail-note">
        {{ t("plugins.legacyFsDowngraded") }}
      </p>
    </div>
  </details>
</template>
