<script setup lang="ts">
/**
 * The four import panels (Settings → Import).
 *
 * A stack that holds every import
 * surface — external sessions, model configs, scanned skills, scanned MCP
 * servers.
 */
import SessionImportPanel from "./SessionImportPanel.vue";
import ModelConfigImportPanel from "./ModelConfigImportPanel.vue";
import SkillsScanImportPanel from "./SkillsScanImportPanel.vue";
import McpScanImportPanel from "./McpScanImportPanel.vue";
</script>

<template>
  <div class="settings-stack">
    <SessionImportPanel />
    <ModelConfigImportPanel />
    <SkillsScanImportPanel />
    <McpScanImportPanel />
  </div>
</template>
