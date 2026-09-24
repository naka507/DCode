<script setup lang="ts">
/**
 * One transcript row, dispatched on the entry's kind: an assistant turn, a
 * compaction divider, or a plain message.
 *
 * The `TranscriptEntryView` component. Its module held six exports; an SFC
 * holds one component, so this one lives in its
 * own file and `AssistantTurn.vue` re-exports it under the same name.
 *
 * Three early returns are one `v-if`/`v-else-if`/`v-else` chain
 * over `entry.kind`, which is the same dispatch in the same order. The
 * `isActive` and `runtimeActivity` props are passed through to a turn and
 * ignored by the other two branches, in the same way as they are passed.
 */
import type { AgentActivity } from "@dcode/shared";
import type { TranscriptEntry } from "../../../lib/assistant-turns";
import AssistantTurn from "./AssistantTurn.vue";
import CompactionRow from "./CompactionRow.vue";
import MessageRow from "./MessageRow.vue";

const props = defineProps<{
  entry: TranscriptEntry;
  isRunning: boolean;
  isActive: boolean;
  runtimeActivity?: AgentActivity;
}>();
</script>

<template>
  <AssistantTurn
    v-if="props.entry.kind === 'assistant-turn'"
    :entry="props.entry"
    :is-active="props.isActive"
    :runtime-activity="props.runtimeActivity"
  />
  <CompactionRow
    v-else-if="props.entry.kind === 'compaction'"
    :mark="props.entry.mark"
  />
  <MessageRow v-else :message="props.entry.message" :is-running="props.isRunning" />
</template>
