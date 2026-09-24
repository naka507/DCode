/**
 * The framework-free half of the activity group
 * (601 lines), which exports six things from one module.
 *
 * The module is split along the same seam:
 *
 *   - here: the three exported helpers (`activityItemDetail`, `runActivityLabel`,
 *     `activityItemsEqual`), the row projection `renderActivityRows`, and the
 *     private label builders the helpers need;
 *   - one `.vue` per component: `ActivityGroup.vue` (the group itself, which
 *     re-exports all six original names), `ActivityGroupRows.vue` (the group's
 *     shared row list), `WorkingIndicator.vue`, `RunActivityIndicator.vue` and
 *     `PlanningIndicator.vue`.
 *
 * A call site therefore only changes its import path (`./ActivityGroup` ->
 * `./ActivityGroup.vue`); every name stays reachable from that specifier.
 *
 * The decisions that are not mechanical:
 *
 *  1. **The comparator is not needed.** `activityGroupPropsEqual` existed
 *     only to skip re-renders; a Vue component re-renders when a value its
 *     template reads changes. `activityItemsEqual` itself stays, because
 *     `AssistantTurn.vue` imports it from the module.
 * 2. **`delegationRosterOutcome` is not imported.** The import list named
 *     it (line 29) but nothing in the module used it, so no
 *     dead import is carried.
 * 3. **`renderActivityItems` becomes `renderActivityRows`.** The closure
 *     returned VNodes with a `renderedTopology` latch; the same latch here
 *     produces descriptors, because the group's two roots (the embedded
 *     `turn-process-activity` div and the ordinary `tool-activity-group` card)
 *     both render the list and an SFC has one template per file. The latch, the
 *     four row kinds and their keys are unchanged.
 * 4. `Translate` is a local alias for the `t` function, kept so
 *     `runActivityLabel`'s signature is unchanged.
 */
import type {
  AgentActivity,
  HostedSearchRound,
  UiMessage,
} from "@dcode/shared";
import { PROVIDER_RETRY_MAX_RETRIES } from "@dcode/shared";
import type { AssistantActivityItem, SubagentRun } from "../../../lib/assistant-turns";
import {
  messageThinking as thinkingText,
  subagentRunsEqual,
} from "../../../lib/assistant-turns";
import {
  delegationRoster,
  delegationRosterSummary,
  isDelegationActivityItem,
  lifecycleKindOf,
} from "../../../lib/subagent-topology";
import { getToolSummary } from "../../../lib/tool-display";

export type Translate = (key: string, options?: Record<string, unknown>) => string;

type ActivityItem = AssistantActivityItem;

export function activityItemDetail(item: ActivityItem): string {
  if (item.kind === "hostedSearch") return item.round.query ?? "";
  if (item.kind === "thinking") {
    // Latest thought line, so a collapsed header reads like a live ticker.
    const lines = thinkingText(item.message)
      .split("\n")
      .map((line) => line.replace(/^#+\s*|\*\*/g, "").trim())
      .filter(Boolean);
    return lines[lines.length - 1] || "";
  }
  if (lifecycleKindOf(item.message)) {
    return delegationRosterSummary(delegationRoster(item.message));
  }
  return getToolSummary(item.message.toolName, item.message.toolArgs);
}

function waitingSubagentsLabel(
  _activity: Extract<AgentActivity, { phase: "waiting-subagents" }>,
  t: Translate,
): string {
  return t("chat.waitingForAgents");
}

function retryDelaySeconds(
  activity: Extract<AgentActivity, { phase: "retrying" }>,
  now: number,
): number {
  const delayMs = activity.retryDelayMs ?? 0;
  const elapsedMs = Math.max(0, now - activity.since);
  return Math.max(0, Math.ceil((delayMs - elapsedMs) / 1000));
}

export function runActivityLabel(
  activity: AgentActivity,
  t: Translate,
  now = Date.now(),
): string {
  switch (activity.phase) {
    case "starting":
      return t("chat.startingTurn");
    case "waiting-model":
      return t("chat.waitingForModel");
    case "preparing":
      return t("chat.preparingNextRequest");
    case "compacting":
      return t("chat.compactingContext");
    case "recovering":
      return t("chat.recoveringTurn");
    case "retrying":
      return t("chat.retryingModel", {
        delaySeconds: retryDelaySeconds(activity, now),
        attempt: activity.attempt,
        maxAttempts: PROVIDER_RETRY_MAX_RETRIES,
      });
    case "waiting-subagents":
      return waitingSubagentsLabel(activity, t);
  }
}

/** Whether two activity items render identically, delegate rows included. */
export function activityItemsEqual(
  previous: ActivityItem,
  next: ActivityItem,
): boolean {
  if (previous.kind !== next.kind || previous.message !== next.message) {
    return false;
  }
  if (previous.kind === "tool" && next.kind === "tool") {
    return subagentRunsEqual(previous.delegate, next.delegate);
  }
  if (previous.kind === "hostedSearch" && next.kind === "hostedSearch") {
    return previous.round === next.round;
  }
  return true;
}

/**
 * One entry of the group's row list.
 *
 * `isLast` is the `itemIndex === items.length - 1`, precomputed because
 * the row list is rendered from a child component and the index would otherwise
 * have to travel with it. The tool row carries it too since 39cde7c0: detailed
 * mode opens the last tool of the last activity part, so the projection has to
 * answer for all three row kinds, not only the two that open automatically.
 */
export type ActivityGroupRow =
  | { key: string; kind: "topology" }
  | { key: string; kind: "tool"; message: UiMessage; isLast: boolean; delegate?: SubagentRun }
  | { key: string; kind: "hostedSearch"; message: UiMessage; round: HostedSearchRound; isLast: boolean }
  | { key: string; kind: "thinking"; message: UiMessage; isLast: boolean };

/**
 * the `renderActivityItems`: the delegation card replaces the first
 * `Task` row it covers, and every other item renders by kind.
 */
export function renderActivityRows(
  items: readonly AssistantActivityItem[],
  hasSubagentTopology: boolean,
): ActivityGroupRow[] {
  const rows: ActivityGroupRow[] = [];
  let renderedTopology = false;
  items.forEach((item, itemIndex) => {
    if (hasSubagentTopology && isDelegationActivityItem(item)) {
      if (renderedTopology) return;
      renderedTopology = true;
      rows.push({ key: "subagent-topology", kind: "topology" });
      return;
    }
    // The user request: 对话记录中不用显示等待子智能体执行，也不需要显示已等待子智能体
    if (item.kind === "tool" && lifecycleKindOf(item.message) === "wait") {
      return;
    }
    const isLast = itemIndex === items.length - 1;
    if (item.kind === "tool") {
      rows.push({
        key: item.message.id,
        kind: "tool",
        message: item.message,
        isLast,
        ...(item.delegate ? { delegate: item.delegate } : {}),
      });
      return;
    }
    if (item.kind === "hostedSearch") {
      rows.push({
        key: `hosted-search-${item.message.id}-${item.round.id}`,
        kind: "hostedSearch",
        message: item.message,
        round: item.round,
        isLast,
      });
      return;
    }
    rows.push({
      key: `thinking-${item.message.id}`,
      kind: "thinking",
      message: item.message,
      isLast,
    });
  });
  return rows;
}
