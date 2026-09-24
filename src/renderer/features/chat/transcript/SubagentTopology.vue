<script setup lang="ts">
/**
 * A truthful one-level graph of one parent fan-out (ADR 0062).
 *
 * The runtime has no delegate-to-delegate edges, so this deliberately stops at
 * main agent -> Task nodes instead of implying dependencies that do not exist.
 *
 * The `SubagentTopology` component, the
 * second of the module's two exported components. An SFC holds one template,
 * second of that module's two exported components. An SFC holds one template,
 * and the class-name contract reads `<template>` blocks, so the component lives
 * in its own file and `SubagentDetail.vue` re-exports it under the original
 * specifier — the same split, for the same reason, that `ToolRow.vue` /
 * `SubagentRunRows.vue` records.
 *
 * The implementation decisions that are not mechanical:
 *
 *  1. **`onUserInteraction` stays a callback prop, called directly.** It
 *     declared it as a prop and its only caller (`ActivityGroup`) passes
 *     `claimDisclosure` that way, so this keeps the prop rather than converting
 *     it to an emit. A declared `onUserInteraction` prop receives the handler
 *     from *both* `@user-interaction="…"` and `:on-user-interaction="…"`, so
 *     either call-site form reaches it exactly once; an emit would only answer
 *     the first.
 *  2. **The conditional prop spreads are gone.** The
 *     `{...(item.delegate ? { delegate: item.delegate } : {})}` and the same
 *     shape for the two maps, because a JSX-style object spread would otherwise pass an
 *     explicit `undefined`. An absent Vue prop and an explicitly `undefined`
 *     one are the same thing for an optional prop, so the spreads have no
 *     counterpart.
 *  3. **A component re-renders only when its reactive dependencies change**,
 *     and `useId()` is Vue's own.
 */
import { computed, useId } from "vue";
import { useI18n } from "vue-i18n";
import { IconTarget } from "../../../lib/icons";
import {
  summarizeSubagentActivity,
  type DelegationActivityItem,
  type SubagentOutcome,
  type SubagentTiming,
} from "../../../lib/subagent-topology";
import ToolRow from "./ToolRow.vue";

const props = defineProps<{
  items: DelegationActivityItem[];
  delegationStatuses?: ReadonlyMap<string, SubagentOutcome>;
  delegationTimings?: ReadonlyMap<string, SubagentTiming>;
  onUserInteraction?: () => void;
}>();


const { t } = useI18n();
const labelId = useId();

const summary = computed(() =>
  summarizeSubagentActivity(props.items, props.delegationStatuses),
);

/** The `onUserInteraction={claimDisclosure}`, called directly. */
function notifyUserInteraction(): void {
  props.onUserInteraction?.();
}
</script>

<template>
  <section class="subagent-topology" :aria-labelledby="labelId">
    <div class="subagent-topology-root">
      <span class="subagent-topology-root-icon" aria-hidden="true">
        <IconTarget :size="16" />
      </span>
      <span class="subagent-topology-root-copy">
        <strong :id="labelId">{{ t("chat.subagentCoordinator") }}</strong>
        <span>{{ t("chat.subagentCoordinating", { count: summary.total }) }}</span>
      </span>
    </div>
    <span class="subagent-topology-connector" aria-hidden="true" />
    <div
      class="subagent-topology-agents"
      role="list"
      :aria-label="t('chat.subagentTopology')"
    >
      <ToolRow
        v-for="item in props.items"
        :key="item.message.id"
        :message="item.message"
        :delegate="item.delegate"
        variant="topology"
        :delegation-statuses="props.delegationStatuses"
        :delegation-timings="props.delegationTimings"
        @user-interaction="notifyUserInteraction"
      />
    </div>
  </section>
</template>
