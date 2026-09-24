import {
  readTranscriptModule,
  readTranscriptSource,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import test from "node:test";

/**
 * Covers the "detailed mode opens the last tool while compact keeps payloads
 * collapsed" case (sha 39cde7c0).
 *
 * The case was written against the reference UI's component sources and JSX
 * props, so the ones that could not survive the translation are stated here
 * explicitly:
 *
 *  - `function useAutomaticDisclosure(automaticOpen: boolean, revealRequest?)`
 *    -> the hook here takes a ref *or* a getter, because Vue has to `watch`
 *    the source. Asserting that signature would pin a shape this tree
 *    deliberately does not have; the test asserts the hook's own gate instead.
 *  - `useRef(false)` / `userInteractedRef.current` -> `let userInteracted`
 *    inside the hook's closure, so there is no `.current` to match.
 *  - `useLayoutEffect(() => {` -> `watch(readAutomatic, ..., { flush: "post" })`.
 *  - `<ThinkingRow ... autoOpen={live && itemIndex === items.length - 1} />` ->
 *    the row list is a child component (`ActivityGroupRows.vue`), so the
 *    index-based gate became the `isLast` the projection precomputes.
 *  - `<ToolRow ... autoOpen={autoOpenLatest} />` -> the Vue binding is
 *    `:auto-open="autoOpenOf(row)"`, and `autoOpenLatest` is the group's
 *    `!compact && isLast`.
 *  - `transcriptToolRowSource` has no separate reader; `readTranscriptModule`
 *    names the file directly.
 */

const transcriptSource = await readTranscriptSource();
const toolRowSource = await readTranscriptModule("ToolRow.vue");
const hostedSearchSource = await readTranscriptModule("HostedSearchRow.vue");
const rowsSource = await readTranscriptModule("ActivityGroupRows.vue");

test("detailed mode opens the last tool while compact keeps payloads collapsed", () => {
  assert.match(transcriptSource, /function useAutomaticDisclosure\(/);
  assert.match(transcriptSource, /let userInteracted = false/);
  assert.match(transcriptSource, /watch\(\s*readAutomatic,/);
  assert.match(transcriptSource, /\{ flush: "post" \}/);
  assert.match(transcriptSource, /if \(userInteracted\) return/);
  assert.match(
    transcriptSource,
    /const \{ open, toggle, collapse, titleRef \} = useAutomaticDisclosure\(/,
  );
  // The group resolves the part-level half of `autoOpenLatest`; the row list
  // supplies the item-level `isLast`.
  assert.match(
    transcriptSource,
    /const autoOpenLatest = computed\(\(\) => !compact\.value && props\.isLast\)/,
  );
  assert.match(rowsSource, /:auto-open="autoOpenOf\(row\)"/);
  assert.match(rowsSource, /props\.autoOpenLatest && row\.isLast/);
  assert.match(rowsSource, /props\.live && row\.isLast/);
  // The tool row opens only when the gate says so, and never on a failure or a
  // denial, which stay visible in the row head instead.
  assert.match(
    toolRowSource,
    /const \{ open, toggle, collapse, titleRef \} = useAutomaticDisclosure\(\s*\(\) => Boolean\(props\.autoOpen\) && !failed\.value && status\.value !== "denied",\s*\)/,
  );
  // The hosted-search row follows the same gate, minus the failure branch that
  // a search round carries instead. The row is round-keyed since 2e763893, so
  // the failure it checks for is the round's own status.
  assert.match(
    hostedSearchSource,
    /const failed = computed\(\(\) => props\.round\.status === "failed"\)/,
  );
  assert.match(
    hostedSearchSource,
    /useAutomaticDisclosure\(\(\) => props\.autoOpen && !failed\.value\)/,
  );
});

test("failure and denial keep their payload collapsed in detailed mode", () => {
  assert.match(toolRowSource, /const failed = computed\(\(\) => status\.value === "error" \|\| run\.value === "failed"\)/);
  assert.match(toolRowSource, /if \(status\.value === "error"\) return t\("chat\.toolFailed"\)/);
});
