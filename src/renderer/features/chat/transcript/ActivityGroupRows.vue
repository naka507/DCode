<script setup lang="ts">
/**
 * The activity group's row list, shared by its two roots.
 *
 * The activity group builds this list twice, once from each of its roots —
 * once for the embedded `turn-process-activity` div and once inside the
 * `tool-activity-group` card's body — and an SFC has a single template, so the
 * list lives here and both branches render this component. The projection itself
 * (including the `renderedTopology` latch that lets one delegation card stand in
 * for every `Task` row it covers) is `renderActivityRows` in
 * `./activity-group.ts`.
 *
 * The component renders a fragment: `v-for` over a keyed `<template>` puts the
 * `Task` row and its `ReviewChangeCard` side by side exactly as a
 * `<Fragment key={item.message.id}>` did, and adds no element of its own — which
 * matters, because `styles/messages.css` targets `.tool-activity-body > .tool-row`
 * as a direct child.
 *
 * The decisions that are not mechanical:
 *
 *  1. **`onUserInteraction={claimDisclosure}` keeps two spellings, one per row
 *     kind.** The group's `claimDisclosure` goes down to every row as a
 *     prop. `SubagentTopology.vue` declares that prop *and* re-emits it, so the
 *     binding has to be `@user-interaction` — Vue's `emit()` looks the handler up
 *     under the camelCase `onUserInteraction` vnode key, which is exactly what
 *     `@user-interaction` compiles to, while `:on-user-interaction` would produce
 *     the literal `"on-user-interaction"` key that `emit()` never reads (verified
 *     against `runtime-core`). `ToolRow`, `HostedSearchRow` and `ThinkingRow` emit
 *     too, so they take the same listener form. This component's own
 *     `onUserInteraction` prop is a plain callback the parent reads through
 *     `claim()` below, so the parent passes it as a prop.
 *  2. **The conditional prop spread is gone.** A conditional spread was written
 *     `{...(item.delegate ? { delegate: item.delegate } : {})}` because JSX
 *     JSX would otherwise pass an explicit `undefined`; an absent Vue prop and an
 *     explicitly `undefined` one are the same thing for an optional prop.
 *  3. **`itemIndex === items.length - 1` is the precomputed `isLast`.** The index
 *     would otherwise have to travel with every row just to be compared against a
 *     length this component does not own.
 */
import type { SubagentRun } from "../../../lib/assistant-turns";
import type {
  DelegationActivityItem,
  SubagentOutcome,
  SubagentTiming,
} from "../../../lib/subagent-topology";
import type { ActivityGroupRow } from "./activity-group";
import HostedSearchRow from "./HostedSearchRow.vue";
import ReviewChangeCard from "../../../components/ReviewChangeCard.vue";
import { SubagentTopology } from "./SubagentDetail.vue";
import ThinkingRow from "./ThinkingRow.vue";
import ToolRow from "./ToolRow.vue";

const props = defineProps<{
  rows: ActivityGroupRow[];
  /** Only the `Task` items of the group, in transcript order. */
  delegateItems: DelegationActivityItem[];
  delegationStatuses: ReadonlyMap<string, SubagentOutcome>;
  delegationTimings: ReadonlyMap<string, SubagentTiming>;
  isActive: boolean;
  live: boolean;
  /**
   * The `autoOpenLatest`: detailed mode, the turn's last activity part.
   * The group resolves it once; a row still has to be the group's own last.
   */
  autoOpenLatest: boolean;
  onUserInteraction?: () => void;
}>();

/** The `claimDisclosure`, handed to every row the group renders. */
function claim(): void {
  props.onUserInteraction?.();
}

/** `item.delegate`, which only a `Task` row carries. */
function delegateOf(row: ActivityGroupRow): SubagentRun | undefined {
  return row.kind === "tool" ? row.delegate : undefined;
}

/** The `streaming={isActive && item.message.status === "streaming"}`. */
function streamingOf(row: ActivityGroupRow): boolean {
  if (row.kind !== "hostedSearch" && row.kind !== "thinking") return false;
  return props.isActive && row.message.status === "streaming";
}

/**
 * The `autoOpen={live && itemIndex === items.length - 1}` for the
 * thinking row, and `autoOpen={autoOpenLatest}` for the other two, where
 * `autoOpenLatest` is `!compact && isLast && itemIndex === items.length - 1`
 * (39cde7c0). `isLast` is the group's own last-row flag; `autoOpenLatest` is
 * the part-level gate the group resolved, so compact mode and a non-final
 * activity part both keep every payload collapsed.
 */
function autoOpenOf(row: ActivityGroupRow): boolean {
  if (row.kind === "topology") return false;
  if (row.kind === "thinking") return props.live && row.isLast;
  return props.autoOpenLatest && row.isLast;
}
</script>

<template>
  <template v-for="row in props.rows" :key="row.key">
    <SubagentTopology
      v-if="row.kind === 'topology'"
      :items="props.delegateItems"
      :delegation-statuses="props.delegationStatuses"
      :delegation-timings="props.delegationTimings"
      @user-interaction="claim"
    />
    <template v-else-if="row.kind === 'tool'">
      <ToolRow
        :message="row.message"
        :auto-open="autoOpenOf(row)"
        :delegate="delegateOf(row)"
        :delegation-statuses="props.delegationStatuses"
        :delegation-timings="props.delegationTimings"
        @user-interaction="claim"
      />
      <ReviewChangeCard :message="row.message" />
    </template>
    <HostedSearchRow
      v-else-if="row.kind === 'hostedSearch'"
      :round="row.round"
      :streaming="streamingOf(row)"
      :auto-open="autoOpenOf(row)"
      @user-interaction="claim"
    />
    <ThinkingRow
      v-else
      :message="row.message"
      :streaming="streamingOf(row)"
      :auto-open="autoOpenOf(row)"
      @user-interaction="claim"
    />
  </template>
</template>
