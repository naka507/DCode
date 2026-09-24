<script setup lang="ts">
/**
 * Match emphasis for global-search rows.
 *
 * The `SearchHighlight` component. It returns a bare fragment — the
 * leading text, one `<mark class="search-hit">` per match, then the trailing
 * remainder — with no wrapper element. The rendered DOM is kept exactly:
 * a `<template v-for>` root (the fragment `key` becomes the `v-for`
 * key) followed by the trailing interpolation, so a wrapper `<span>` never
 * enters the row markup and the existing row styles keep applying.
 *
 * The `let end = 0` cursor is carried into the `computed` that builds
 * the segments; the rendered text is unchanged. The leading and trailing
 * slices are glued to their neighbours with no whitespace in the template,
 * because JSX emitted adjacent nodes with no whitespace text between them.
 */
import { computed } from "vue";
import { searchMatchRanges } from "../lib/session-search";

const props = defineProps<{ text: string; query: string }>();

const parts = computed(() => {
  const ranges = searchMatchRanges(props.text, props.query);
  const segments: { start: number; before: string; match: string }[] = [];
  let end = 0;
  for (const [start, next] of ranges) {
    segments.push({
      start,
      before: props.text.slice(end, start),
      match: props.text.slice(start, next),
    });
    end = next;
  }
  return { segments, rest: props.text.slice(end) };
});
</script>

<template>
  <template v-for="segment in parts.segments" :key="segment.start">{{ segment.before }}<mark class="search-hit">{{ segment.match }}</mark></template>{{ parts.rest }}
</template>
