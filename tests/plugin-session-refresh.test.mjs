import { readMainSourceSync } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, "..");
const protocol = readFileSync(
  join(desktopRoot, "src/shared/protocol.ts"),
  "utf8",
);
const api = readFileSync(join(desktopRoot, "src/renderer/lib/api.ts"), "utf8");
const main = readMainSourceSync();

test("plugin session mutations use the host-owned renderer refresh event", () => {
  assert.match(protocol, /sessionsChanged:\s*"dcode\/session\/event\/changed"/);
  assert.match(api, /onSessionsChanged:/);
  assert.match(api, /IPC\.event\.sessionsChanged/);
  assert.match(main, /method === "plugin\.session\.import"/);
  assert.match(main, /method === "plugin\.session\.importBatch"/);
  assert.match(main, /sendToRenderer\(IPC\.event\.sessionsChanged/);
});
