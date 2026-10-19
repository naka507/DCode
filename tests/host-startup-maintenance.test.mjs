import assert from "node:assert/strict";
import test from "node:test";
import { readMainSource } from "./helpers/main-source.mjs";

test("startup prunes turn_events retention best-effort (ADR-001 follow-up)", async () => {
  const main = await readMainSource();
  // The prune call rides the default DCore retention; DCode passes no cutoff.
  assert.match(main, /h\.call\("turn\.pruneEvents"\)/);
  assert.doesNotMatch(main, /turn\.pruneEvents",\s*\{/);
});

test("turn.pruneEvents failure cannot break startup", async () => {
  const main = await readMainSource();
  // Best-effort by contract: older DCore builds predate the RPC and answer
  // unknown-method, which must degrade to a warning, not a failed boot.
  assert.match(
    main,
    /try \{\s*const pruned = await h\.call\("turn\.pruneEvents"\);[\s\S]*?\} catch/,
  );
});
