<script setup lang="ts">
/**
 * Permission chips for an installed plugin row.
 *
 * The `PermissionChips` component. `permissions` and `limit` are
 * props; the `t(., { defaultValue: permission })` fallback is dropped
 * because every permission name the host can report has a catalog entry (see
 * `plugins.permissionHelp`), so the fallback never fired.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { INLINE_PERMISSION_LIMIT, orderPermissions, permissionLabel, permissionRisk } from "./model";

const props = withDefaults(
  defineProps<{
    permissions: readonly string[] | undefined;
    limit?: number;
  }>(),
  { limit: INLINE_PERMISSION_LIMIT },
);

const { t } = useI18n();

const ordered = computed(() => orderPermissions(props.permissions));
const shown = computed(() => ordered.value.slice(0, props.limit));
const hidden = computed(() => ordered.value.length - shown.value.length);
const hiddenTitle = computed(() =>
  ordered.value
    .slice(props.limit)
    .map((permission) => permissionLabel(permission, t))
    .join(" · "),
);
</script>

<template>
  <span v-if="ordered.length === 0" class="plugins-perm-none">{{
    t("plugins.noPermissions")
  }}</span>
  <span v-else class="plugins-perm-chips">
    <span
      v-for="permission in shown"
      :key="permission"
      class="plugins-perm-chip"
      :class="{
        'risk-high': permissionRisk(permission) === 'high',
        'risk-medium': permissionRisk(permission) === 'medium',
        'risk-low': permissionRisk(permission) === 'low',
      }"
      :title="t(`plugins.permissionHelp.${permission}`)"
    >
      {{ permissionLabel(permission, t) }}
    </span>
    <span v-if="hidden > 0" class="plugins-perm-chip is-more" :title="hiddenTitle">
      {{ t("plugins.permsMore", { count: hidden }) }}
    </span>
  </span>
</template>
