<script setup lang="ts">
/**
 * Action glyph for a tool row.
 *
 * One `{ size: 15, "aria-hidden": true }` props object is spread over the chosen
 * icon; a `v-if`/`v-else-if` chain over the same switch does the same job here.
 */
import type { ToolAction } from "../../../lib/tool-display";
import {
  IconBot,
  IconBranch,
  IconFileText,
  IconFolder,
  IconGlobe,
  IconPencil,
  IconSearch,
  IconTerminal,
  IconWrench,
} from "../../../lib/icons";

const props = defineProps<{ action: ToolAction }>();
</script>

<template>
  <IconFileText v-if="props.action === 'read'" :size="15" aria-hidden />
  <IconFolder v-else-if="props.action === 'list'" :size="15" aria-hidden />
  <IconSearch v-else-if="props.action === 'search'" :size="15" aria-hidden />
  <IconPencil
    v-else-if="props.action === 'write' || props.action === 'edit'"
    :size="15"
    aria-hidden
  />
  <IconTerminal v-else-if="props.action === 'run'" :size="15" aria-hidden />
  <IconGlobe v-else-if="props.action === 'fetch'" :size="15" aria-hidden />
  <IconBranch v-else-if="props.action === 'fork'" :size="15" aria-hidden />
  <IconBot v-else-if="props.action === 'delegate'" :size="15" aria-hidden />
  <IconWrench v-else :size="15" aria-hidden />
</template>
