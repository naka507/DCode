import { readStoreModule, readStoreSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtimeSource = await readFile(
  new URL("../src/agent/runtime/runtime.ts", import.meta.url),
  "utf8",
);
const toolPresentationSource = await readFile(
  new URL("../src/renderer/lib/tool-presentation.ts", import.meta.url),
  "utf8",
);
const storeSource = await readStoreSource();
const eventsSource = await readStoreModule("slices/events-slice.ts");
const sessionRuntimeSource = await readStoreModule("runtime/session-runtime.ts");
const messagesCss = await readFile(
  new URL("../src/renderer/styles/messages.css", import.meta.url),
  "utf8",
);
const topologySource = await readFile(
  new URL("../src/renderer/lib/subagent-topology.ts", import.meta.url),
  "utf8",
);
const toolDisplaySource = await readFile(
  new URL("../src/renderer/lib/tool-display.ts", import.meta.url),
  "utf8",
);
const englishCatalogSource = await readFile(
  new URL("../src/i18n/locales/en/index.ts", import.meta.url),
  "utf8",
);
const chineseCatalogSource = await readFile(
  new URL("../src/i18n/locales/zh-CN/index.ts", import.meta.url),
  "utf8",
);

test("a delegation card reads its outcome from the lifecycle rows", () => {
  // `Task` returns as soon as the delegate starts, so its own payload says
  // `running` forever. Treating that as "no status" made every card claim
  // `completed` the moment the fan-out began.
  assert.match(topologySource, /const DELEGATION_STATUSES = new Set<SubagentOutcome>\(\[\s*\n\s*"running",/);
  assert.match(topologySource, /export function collectDelegationStatuses\(/);
  // TaskWait/TaskList report `details.delegations[]`; TaskStop reports
  // `details.stopped[]`. Later rows settle what earlier ones reported as running.
  assert.match(topologySource, /payload\.delegations/);
  assert.match(topologySource, /payload\.stopped/);
  assert.match(topologySource, /statuses\.set\(id, status\)/);
  assert.match(topologySource, /turnLive/);
  assert.match(
    topologySource,
    /const settled = statuses\?\.get\(delegationId\);\s*\n\s*if \(settled\) return settled;/,
  );
  // The lifecycle rows are still excluded from the topology's node count.
  assert.match(topologySource, /if \(isDelegationActivityItem\(item\)\) continue;/);
});

test("a lifecycle row summarizes by agent name, never by delegation id", () => {
  // Superseded the `delegationIds` summary (D268): the ids a lifecycle row is
  // called with are bare UUIDs, so the row reads the roster the runtime
  // returned and names the subagents instead.
  assert.match(toolDisplaySource, /delegate: \["description", "agent"\]/);
  assert.doesNotMatch(toolDisplaySource, /"delegationIds"/);
  assert.doesNotMatch(toolDisplaySource, /"delegationids"/);
  assert.match(toolDisplaySource, /function summaryText\(value: unknown\): string/);
  assert.match(toolDisplaySource, /Array\.isArray\(value\) && value\.every\(/);
  assert.doesNotMatch(toolDisplaySource, /record\[key\] as string/);
  // The roster is read from both payload shapes the lifecycle tools return.
  assert.match(topologySource, /export function delegationRoster\(/);
  assert.match(topologySource, /Array\.isArray\(payload\.stopped\)/);
  // A repeated definition is counted rather than listed twice.
  assert.match(topologySource, /count > 1 \? `\$\{name\} ×\$\{count\}` : name/);
  // The row's badge rolls the roster up with the shared status vocabulary.
  // A lifecycle row is presented as a subagent row, not as "Delegated".
  // It never falls back to its own arguments, so a pending wait shows no ids.
  // ...and it is still not a topology node.
  assert.match(topologySource, /if \(isDelegationActivityItem\(item\)\) continue;/);
});

test("a live delegate row keeps the attribution its stream carried", () => {
  // Without these the row would render as a top-level tool call until the
  // session was reloaded from host-core.
  assert.match(
    storeSource,
    /envelope\.parentToolCallId\n\s+\? \{ parentToolCallId: envelope\.parentToolCallId \}/,
  );
  assert.match(storeSource, /envelope\.agentName \? \{ agentName: envelope\.agentName \}/);
});

test("a terminal tool event repairs a row lost during renderer reload", () => {
  assert.match(sessionRuntimeSource, /const toolStartsByCallId = new Map/);
  assert.match(eventsSource, /const existing = state\.messages\.some\(/);
  assert.match(
    eventsSource,
    /messages: existing\s*\? state\.messages\.map\([\s\S]*?: \[\.\.\.state\.messages, completed\]/,
  );
  assert.match(eventsSource, /toolDurationMs: toolStart\s*\n\s*\? Math\.max/);
  assert.match(eventsSource, /toolName: message\.toolName \?\? completed\.toolName/);
});

test("a Task node shows the effective model after the subagent name", () => {
  assert.match(
    runtimeSource,
    /startedAt,\s*\n\s*modelId: provider\.modelId,/,
  );
  assert.match(
    toolPresentationSource,
    /key !== "agent" &&[\s\S]*?key !== "error" &&[\s\S]*?key !== "modelId" &&[\s\S]*?key !== "thinkingLevel"/,
  );
  assert.match(
    messagesCss,
    /\.subagent-topology-node-model \{[^}]*font-family: var\(--font-mono\)/,
  );
});

test("a Task node and detail header show the effective thinking level", () => {
  assert.match(
    runtimeSource,
    /modelId: provider\.modelId,\s*\n\s*thinkingLevel,/,
  );
  assert.match(
    runtimeSource,
    /modelId: record\.modelId,\s*\n\s*thinkingLevel: record\.thinkingLevel,/,
  );
});

test("the nested run is visibly one level inside the call", () => {
  // D297: the run is a soft tile; the collapse rail draws nothing at rest and
  // only shows its bar as a hover/focus affordance.
  assert.match(messagesCss, /\.subagent-run \{[^}]*background: var\(--ds-tile\)/);
  assert.match(
    messagesCss,
    /\.disclosure-collapse-rail::before \{[^}]*background: transparent/,
  );
  assert.doesNotMatch(messagesCss, /\.subagent-run > \.disclosure-collapse-rail::before/);
  assert.match(messagesCss, /\.subagent-run \{[^}]*margin: 2px 0 8px 24px/);
  assert.match(messagesCss, /\.subagent-run-count \{[^}]*margin-inline-start: auto/);
  assert.match(messagesCss, /\.tool-row-agent \{/);
});

test("every Task row renders as one accessible delegation topology", () => {
  // One delegation gets the same card as a fan-out: the compact row hid the
  // outcome, runtime and step count the card states outright.
  assert.match(storeSource, /toggleSubagentPanel:\s*\(delegationId\) => \{/);
  assert.match(
    storeSource,
    /state\.subagentPanel\?\.sessionId === sessionId[\s\S]*?state\.subagentPanel\.delegationId === id[\s\S]*?set\(\{ subagentPanel: null \}\)/,
  );
});

test("the aggregate label counts, so a lone delegation is not called plural", () => {
  for (const [locale, source] of [
    ["en", englishCatalogSource],
    ["zh-CN", chineseCatalogSource],
  ]) {
    for (const key of [
      "subagentsWorking",
      "subagentsFinished",
      "subagentsFinishedWithIssues",
      "subagentsFinishedWithWarnings",
    ]) {
      assert.match(source, new RegExp(`\\n\\s*${key}_one: "`), `${locale} ${key}_one`);
      assert.match(
        source,
        new RegExp(`\\n\\s*${key}_other: "`),
        `${locale} ${key}_other`,
      );
      // A bare key would win over the plural forms and bring the plural copy
      // back for a single delegation.
      assert.doesNotMatch(source, new RegExp(`\\n\\s*${key}: "`), `${locale} ${key}`);
    }
  }
  assert.match(englishCatalogSource, /subagentsWorking_one: "Subagent working"/);
  assert.match(englishCatalogSource, /subagentsWorking_other: "Subagents working"/);
});

test("the topology uses semantic low-noise surfaces and responsive connectors", () => {
  assert.match(messagesCss, /\.tool-activity-group\.has-subagents \{/);
  assert.match(messagesCss, /\.subagent-topology \{[^}]*display: grid/);
  // D297: nodes are raised tiles on the group's tile, connectors are tinted
  // bars, and the dotted canvas is gone.
  assert.match(messagesCss, /\.subagent-topology-node \{[^}]*background: var\(--ds-raised\)/);
  assert.doesNotMatch(messagesCss, /\.subagent-topology-node \{[^}]*border:/);
  assert.match(messagesCss, /\.tool-activity-group\.has-subagents \{[^}]*background: var\(--ds-tile\)/);
  assert.doesNotMatch(messagesCss, /\.tool-activity-group\.has-subagents \{[^}]*border:/);
  assert.doesNotMatch(messagesCss, /\.subagent-topology \{[^}]*background-image/);
  assert.match(messagesCss, /\.subagent-topology-connector \{[^}]*background: var\(--ds-tile-deep\)/);
  assert.match(messagesCss, /\.subagent-topology-node::before \{[^}]*height: 2px/);
  assert.match(messagesCss, /\.subagent-topology-node\.outcome-completed/);
  assert.match(messagesCss, /\.subagent-topology-node\.outcome-failed/);
  assert.match(messagesCss, /\.subagent-topology-node\.outcome-timed-out/);
  assert.match(
    messagesCss,
    /@container subagent-activity \(max-width: 520px\)[\s\S]*?\.subagent-topology/,
  );
  assert.match(messagesCss, /\.subagent-topology-node-header:focus-visible/);
});

test("a delegate's rows scroll in place instead of growing the page (D271)", () => {
  // The rows live in their own scroll container, not on `.subagent-run`: the
  // collapse rail is absolutely positioned outside that element's padding box,
  // so an overflow there would clip the rail away.
  // The scroll area is named by the run heading beside it rather than by a
  // duplicated label string.
  assert.match(
    messagesCss,
    /\.subagent-run-rows \{[^}]*max-height: min\(420px, 48dvh\)/,
  );
  assert.match(messagesCss, /\.subagent-run-rows \{[^}]*overflow-y: auto/);
  assert.match(
    messagesCss,
    /\.subagent-run-rows \{[^}]*overscroll-behavior-y: contain/,
  );
  assert.match(
    messagesCss,
    /\.subagent-run-rows \{[^}]*overflow-anchor: none/,
  );
  // A keyboard user can reach the scroll area the pointer already can.
  assert.match(messagesCss, /\.subagent-run-rows:focus-visible \{/);
  // `.subagent-run` itself must stay unclipped so the rail survives.
  assert.doesNotMatch(messagesCss, /\.subagent-run \{[^}]*overflow/);
  // Every field table is bounded too, so a long roster scrolls as well.
  assert.match(messagesCss, /\.tool-fields \{[^}]*max-height: 260px/);
  assert.match(messagesCss, /\.tool-fields \{[^}]*overflow: auto/);
});

test("an expanded delegate run follows the latest output while pinned (D302)", () => {
  // Nested follow is a dedicated hook so the main transcript's history,
  // veil, and pane-visibility machinery stay out of the run scroller.

  // The jump control overlays the bounded scroller; overflow stays off
  // `.subagent-run` so the collapse rail is not clipped.
  assert.match(messagesCss, /\.subagent-run-follow \{[^}]*position: relative/);
  assert.match(
    messagesCss,
    /\.subagent-run-follow > \.jump-latest-btn \{[^}]*bottom: 8px/,
  );
  assert.doesNotMatch(messagesCss, /\.subagent-run \{[^}]*overflow/);
});

test("the delegation card keeps inset from its tile and stays live off the tail (D319)", () => {
  // Parent Read/Grep/thinking after a Task fan-out is a later activity part, so
  // the card is not the turn's live tail while its delegates are still running.
  assert.match(
    messagesCss,
    /\.subagent-topology \{[^}]*padding: 8px 16px 16px/,
  );
  assert.match(
    messagesCss,
    /\.tool-activity-group\.has-subagents \.tool-activity-header \{[^}]*padding: 10px 16px/,
  );
  assert.match(
    messagesCss,
    /\.tool-activity-group\.has-subagents \.tool-activity-body > \.tool-row \{[^}]*margin-left: 16px/,
  );
});
