<script setup lang="ts">
/**
 * The live tail of the transcript: the newest entry, which is the one a running
 * turn keeps rewriting.
 *
 * The `TranscriptTail` component. The module it belongs to holds six exports;
 * an SFC holds one component, so this one lives in its own file and
 * `AssistantTurn.vue` re-exports it under the same name.
 *
 * `memo` wrapped the component with a comparator over
 * `isRunning`, `isActive`, `runtimeActivity` and `transcriptEntryEqual(entry)`.
 * That is gone: the tail re-renders exactly when one of the four values it
 * passes down changes, which is what the comparator decided. The component is
 * still a separate file rather than being inlined at the call site because the
 * scroller renders it outside `TranscriptHistory` — the boundary between the
 * streaming row and the finished ones is the whole point of the split.
 */
import type { AgentActivity } from "@dcode/shared";
import type { TranscriptEntry } from "../../../lib/assistant-turns";
import TranscriptEntryView from "./TranscriptEntryView.vue";

const props = defineProps<{
  entry: TranscriptEntry;
  isRunning: boolean;
  isActive: boolean;
  runtimeActivity?: AgentActivity;
}>();
</script>

<template>
  <TranscriptEntryView
    :entry="props.entry"
    :is-running="props.isRunning"
    :is-active="props.isActive"
    :runtime-activity="props.runtimeActivity"
  />
</template>
