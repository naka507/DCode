<script setup lang="ts">
/**
 * The completed transcript: every history entry before the live tail, rendered
 * as its own row.
 *
 * The `TranscriptHistory` component. The transcript
 * module held six exports; an SFC holds one component, so this one lives in its
 * own file and `AssistantTurn.vue` re-exports it under the same name.
 *
 * The component used to be wrapped in `memo` with `transcriptEntryEqual`,
 * which is gone for the usual reason: a Vue component re-renders only when a
 * value its render reads changes, and the entries array is already identity
 * reused by `lib/assistant-turns.ts`. The row `key` is `transcriptEntryKey`,
 * the same helper as before, so a compaction still keys on its mark id
 * rather than on a message it does not have.
 *
 * The fragment root is a `<template>` here: it renders the rows as
 * siblings with no wrapper element, the same as a `<>` fragment.
 */
import type { TranscriptEntry } from "../../../lib/assistant-turns";
import { transcriptEntryKey } from "./AssistantTurn";
import TranscriptEntryView from "./TranscriptEntryView.vue";

const props = defineProps<{
  entries: TranscriptEntry[];
  isRunning: boolean;
}>();
</script>

<template>
  <template v-for="entry in props.entries" :key="transcriptEntryKey(entry)">
    <TranscriptEntryView
      :entry="entry"
      :is-running="props.isRunning"
      :is-active="false"
    />
  </template>
</template>
