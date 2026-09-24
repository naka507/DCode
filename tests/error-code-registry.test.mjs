import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ErrorCodes } from "@dcode/shared";
import { dcorePath } from "./helpers/sibling-repos.mjs";

/**
 * Keeps the two places an error code lives from drifting apart:
 * `ErrorCodes` (source of truth) and the codes host-core actually emits. A new
 * code must land in both at once.
 *
 * dcode ships no `docs/spec/` tree, so the documented half of the contract is
 * the committed fixture `tests/fixtures/error-codes.md` — a registry record
 * that lives and moves with the code. The emitters live in the host-core Rust
 * crate in the sibling dcore checkout, so that half stays a cross-repo
 * contract: copying the crate into dcode would let the two lists drift, which
 * is what the test exists to catch.
 */

const FIXTURE = "fixtures/error-codes.md";
const RPC = "crates/host-core/src/rpc/mod.rs";
const TOOLS = "crates/host-core/src/tools/mod.rs";
const IGNORE = "crates/host-core/src/tools/ignore_rules.rs";

const rustPaths = { rpc: dcorePath(RPC), tools: dcorePath(TOOLS), ignore: dcorePath(IGNORE) };

// A checkout without dcore cannot verify the host-emitted half; skipping keeps
// the rest of the suite meaningful instead of failing on a missing neighbour.
const skip = Object.values(rustPaths).some((p) => p === null)
  ? "needs the dcore checkout beside dcode"
  : false;

const read = (path) => readFileSync(path, "utf8");

const errorCodesDoc = read(new URL(`./${FIXTURE}`, import.meta.url));
const documented = new Set(
  [...errorCodesDoc.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map((m) => m[1]),
);

/** Codes host-core emits as `errorCode` on JSON-RPC errors and tool results. */
function hostEmittedCodes() {
  const codes = new Set();
  const rpc = read(rustPaths.rpc);
  for (const m of rpc.matchAll(/rpc_err\(\s*-?\d+,\s*[^;]*?"([A-Z][A-Z0-9_]+)"\s*,?\s*\)/gs)) {
    codes.add(m[1]);
  }
  for (const m of rpc.matchAll(/plan_rpc_err\("([A-Z][A-Z0-9_]+)/g)) codes.add(m[1]);
  const tools = read(rustPaths.tools);
  for (const m of tools.matchAll(/\(\s*"([A-Z][A-Z0-9_]+)"\.into\(\)\s*,/g)) codes.add(m[1]);
  for (const m of tools.matchAll(/ToolError::new\(\s*"([A-Z][A-Z0-9_]+)"/g)) codes.add(m[1]);
  const ignore = read(rustPaths.ignore);
  for (const m of ignore.matchAll(/DENIED_CODE: &str = "([A-Z][A-Z0-9_]+)"/g)) codes.add(m[1]);
  return codes;
}

test("every registered error code is recorded in the error-codes fixture", () => {
  const missing = Object.keys(ErrorCodes).filter((code) => !documented.has(code));
  assert.deepEqual(missing, []);
});

test("every code host-core emits is registered in ErrorCodes", { skip }, () => {
  const registry = new Set(Object.values(ErrorCodes));
  const missing = [...hostEmittedCodes()].filter((code) => !registry.has(code)).sort();
  assert.deepEqual(missing, []);
});
