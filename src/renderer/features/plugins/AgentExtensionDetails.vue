<script setup lang="ts">
/**
 * Live state of a plugin's ExtensionAPI modules (spec 07-plugins/16 §11).
 *
 * The `AgentExtensionDetails` component.
 *
 * The state badge is an object of literal names rather than the glued
 * `is-${state}`: the class contract reads literal names, and a glued fragment is
 * reported as a class nothing styles. The diagnostic error flag is the shared
 * `isErrorDiagnostic` helper, and the name list comes from
 * `agentExtensionNames`, both in the sibling `presentation.ts`.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { PluginAgentExtensionStatus } from "@dcode/shared";
import { agentExtensionNames, isErrorDiagnostic } from "./presentation";

const props = defineProps<{ status: PluginAgentExtensionStatus }>();

const { t } = useI18n();

const names = computed(() => agentExtensionNames(props.status));
</script>

<template>
  <div class="plugins-agent-extension">
    <span
      class="agent-capability-badge"
      :class="{
        'is-ready': status.state === 'loaded',
        'is-failed': status.state === 'error',
        'is-level': status.state === 'enabled',
      }"
    >
      {{ t(`plugins.agentExtension.state.${status.state}`) }}
    </span>
    <code v-if="names.length" class="plugins-agent-extension-names">{{
      names.join(" · ")
    }}</code>
    <ul
      v-if="status.diagnostics.length"
      class="agent-extension-diagnostics"
      :aria-label="t('plugins.agentExtension.diagnostics')"
    >
      <li
        v-for="diagnostic in status.diagnostics"
        :key="`${diagnostic.kind}:${diagnostic.member ?? ''}`"
        class="agent-extension-diagnostic"
        :class="{ 'is-error': isErrorDiagnostic(diagnostic.kind) }"
      >
        <span class="agent-extension-diagnostic-kind">
          {{ t(`plugins.agentExtension.kinds.${diagnostic.kind}`) }}
        </span>
        <code v-if="diagnostic.member" class="agent-extension-diagnostic-member">{{
          diagnostic.member
        }}</code>
        <span class="agent-extension-diagnostic-message" :title="diagnostic.stack">
          {{ diagnostic.message }}
        </span>
        <span v-if="diagnostic.count > 1" class="agent-capability-badge"
          >×{{ diagnostic.count }}</span
        >
      </li>
    </ul>
  </div>
</template>
