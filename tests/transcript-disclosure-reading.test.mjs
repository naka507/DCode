import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [anchorControl, scrollInput] = await Promise.all([
  read("../src/renderer/lib/disclosure-anchor.ts"),
  read("../src/renderer/lib/scroll-input.ts"),
]);
test("holding a disclosure leaves follow without a delayed grab-back", () => {
  // No timer, no animation frame: the hold ends on real input or on an explicit
  // re-pin, never by taking the bottom back later.
  assert.doesNotMatch(anchorControl, /requestAnimationFrame|setTimeout/);
});

test("scroll input is attributed to the scroller that can consume it", () => {
  // A press on a control, a keystroke in a field and a nested scroller's input
  // are read from the DOM, not guessed from the event type.
  assert.match(scrollInput, /target\.closest\(`\[\$\{SCROLL_OWNER_ATTRIBUTE\}\]`\)/);
  // Ownership is about the vertical axis only: an element with horizontal
  // overflow alone lets the gesture chain to the scroller behind it, and
  // treating it as consumed would leave the outer viewport un-followed and
  // then re-bottomed.
  assert.match(scrollInput, /consumesVerticalScroll\(nearestOwner\)/);
  assert.doesNotMatch(scrollInput, /scrollWidth/);
  assert.match(scrollInput, /target\.closest\(CONTROL_SELECTOR\)/);
  assert.match(
    scrollInput,
    /context\.pointerOnScrollSurface =\s*inside &&\s*!\(target instanceof Element && target\.closest\(CONTROL_SELECTOR\) !== null\);/,
  );
});

test("a held disclosure is resolved against the scroller that owns it", () => {
  // Growing the dock grows the transcript's content too, so an outer scroller
  // still in follow mode would drag the same title away. The module is
  // the pure half of that: the owning scroller resolves the anchor itself, and
  // a settled frame resolves to `null` so no scroll event is emitted.
  assert.match(anchorControl, /export function resolveDisclosureAnchor\(/);
  assert.match(anchorControl, /export function adoptDisclosureAnchor\(/);
  assert.match(anchorControl, /DISCLOSURE_ANCHOR_TOLERANCE_PX/);
  assert.match(anchorControl, /maxScrollTop/);
});

test("the thinking row, the tool row and the hosted search row each anchor their own header", async () => {
  // The equivalent count was bumped 2 → 3 in `2e763893`: the hosted search row
  // joined the thinking and tool rows as a third manual disclosure, so all
  // three must hand over the element the reader clicked. The header refs used
  // to live in a single transcript module; this tree splits that surface into
  // one component per row, so the guard is the set of rows that both register
  // the header ref and pass the collapse callback.
  const rows = ["ThinkingRow.vue", "ToolRow.vue", "HostedSearchRow.vue"];
  const anchored = [];
  const railed = [];
  for (const row of rows) {
    const source = await read(`../src/renderer/features/chat/transcript/${row}`);
    if (/ref="titleRef"/.test(source) && /useAutomaticDisclosure\(/.test(source)) {
      anchored.push(row);
    }
    if (
      /<DisclosureCollapseRail/.test(source) &&
      /:on-collapse="(?:collapseRow|collapse)"/.test(source)
    ) {
      railed.push(row);
    }
  }
  assert.deepEqual(
    anchored,
    rows,
    "each of the three manual disclosures must register the header it hands to the scroller",
  );
  assert.deepEqual(
    railed,
    rows,
    "each of the three manual disclosures must anchor when its own rail collapses it",
  );
});
