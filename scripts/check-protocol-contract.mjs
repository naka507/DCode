#!/usr/bin/env node
/**
 * ADR-007: verify the DCode<->DCore protocol contract against both repos.
 *
 * Checks:
 *  1. DCode's PROTOCOL_VERSION (src/shared/protocol.ts) == contract version.
 *  2. DCore's PROTOCOL_VERSION (crates/host-core/src/state.rs) == contract version.
 *  3. Contract methods == DCore rpc/mod.rs match arms (no drift either way).
 *  4. Every host.call("…")/transport.call("…") literal in DCode src/ is in the contract.
 *
 * DCore checkout: DCORE_REPO env, default ~/workspace/repos/DCore. DCore-side
 * assertions are skipped with a warning when the checkout is absent.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const root = process.cwd();
const contractPath = join(root, "protocol", "contract.json");
const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const failures = [];

function fail(message) {
  failures.push(message);
}

// 1. DCode protocol version.
const protocolTs = readFileSync(join(root, "src", "shared", "protocol.ts"), "utf8");
const dcodeVersion = Number(
  (protocolTs.match(/export const PROTOCOL_VERSION\s*=\s*(\d+)/) || [])[1],
);
if (dcodeVersion !== contract.version) {
  fail(
    `DCode PROTOCOL_VERSION=${dcodeVersion} != contract version=${contract.version}`,
  );
}

// 2 & 3. DCore side.
const dcoreRepo =
  process.env.DCORE_REPO || join(homedir(), "workspace", "repos", "DCore");
const stateRs = join(dcoreRepo, "crates", "host-core", "src", "state.rs");
const rpcModRs = join(dcoreRepo, "crates", "host-core", "src", "rpc", "mod.rs");
if (!existsSync(stateRs) || !existsSync(rpcModRs)) {
  console.warn(
    `DCore checkout not found at ${dcoreRepo}; skipping DCore-side assertions.`,
  );
} else {
  const stateSrc = readFileSync(stateRs, "utf8");
  const dcoreVersion = Number(
    (stateSrc.match(/PROTOCOL_VERSION\s*:\s*u\d+\s*=\s*(\d+)/) ||
      stateSrc.match(/PROTOCOL_VERSION\s*=\s*(\d+)/) || [])[1],
  );
  if (dcoreVersion !== contract.version) {
    fail(
      `DCore PROTOCOL_VERSION=${dcoreVersion} != contract version=${contract.version}`,
    );
  }

  const rpcSrc = readFileSync(rpcModRs, "utf8");
  const dcoreMethods = new Set(
    [...rpcSrc.matchAll(/"\s*([a-z][a-z0-9_.-]+)"\s*=>/g)].map((m) => m[1]),
  );
  // Prefix-routed methods (e.g. session.collaboration.*) have no exact match
  // arm; the contract lists the concrete ones DCode calls.
  const contractMethods = new Set([
    ...contract.methods,
    ...(contract.collaborationMethods || []),
  ]);
  for (const method of [...dcoreMethods].sort()) {
    if (!contractMethods.has(method)) {
      fail(`DCore implements "${method}" but it is missing from protocol/contract.json`);
    }
  }
  for (const method of [...contract.methods].sort()) {
    if (!dcoreMethods.has(method)) {
      fail(`protocol/contract.json lists "${method}" but DCore has no such method`);
    }
  }
  // The prefix route itself must exist in DCore.
  for (const prefix of contract.dcorePrefixes || []) {
    if (!rpcSrc.includes(`starts_with("${prefix}")`)) {
      fail(`DCore has no prefix route for "${prefix}"`);
    }
  }
}

// 4. DCode call sites.
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      yield* walk(path);
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry)) {
      yield path;
    }
  }
}
const calledMethods = new Set();
for (const file of walk(join(root, "src"))) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(
    /(?:host|transport)\.call(?:<[^>]*>)?\(\s*"([a-z][a-z0-9_.-]+)"/g,
  )) {
    calledMethods.add(m[1]);
  }
}
const contractMethods = new Set(contract.methods);
// DCode may call DCore methods, prefix-routed collaboration methods, and
// host-proxy methods (extensions.* answered by the sidecar, not DCore).
const callableMethods = new Set([
  ...contract.methods,
  ...(contract.collaborationMethods || []),
  ...(contract.hostMethods || []),
]);
for (const method of [...calledMethods].sort()) {
  if (!callableMethods.has(method)) {
    fail(`DCode calls "${method}" but it is not in protocol/contract.json`);
  }
}

if (failures.length > 0) {
  console.error("Protocol contract check FAILED:");
  for (const failure of failures) console.error("  - " + failure);
  process.exit(1);
}
console.log(
  `Protocol contract OK: version ${contract.version}, ${contract.methods.length} methods, ${calledMethods.size} DCode call sites checked.`,
);
