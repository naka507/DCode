import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  DEFAULT_DESKTOP_TOOL_RPC_TIMEOUT_MS,
  DESKTOP_TOOL_DISPATCH_TIMEOUT_MS,
  TOOL_QUEUE_WAIT_MS,
  rpcTimeoutMs,
} from "../src/shared/rpc-timeouts.ts";
import { dcorePath } from "./helpers/sibling-repos.mjs";

// A plugin tool call crosses four processes, and each layer has its own
// deadline. Every inner budget must stay below the one around it, or the outer
// layer times out first and the inner layer's own error never reaches the
// model. The constants live in TypeScript and Rust, so this reads the sources.
//
// The sources are read rather than imported: the constants live in TypeScript
// and Rust, and the host-core crate lives in the sibling `dcore` checkout, so
// the Rust half is read through `dcorePath`. Like the other sibling-checkout
// contracts this skips rather than fails when that checkout is absent.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(repoRoot, path), "utf8");

function constMs(src, name) {
  const match = src.match(new RegExp(`const ${name}(?::\\s*u64)?\\s*=\\s*([\\d_]+)\\s*;`));
  assert.ok(match, `${name} not found`);
  return Number(match[1].replaceAll("_", ""));
}

const pluginRuntime = source("src/main/plugin-runtime.ts");
const pluginMcp = source("src/main/plugin-mcp.ts");
const sharedTimeouts = source("src/shared/rpc-timeouts.ts");

const hostToolsPath = dcorePath("crates/host-core/src/tools/mod.rs");
const hostPermissionsPath = dcorePath("crates/host-core/src/permissions.rs");
const hostToolBudgetPath = dcorePath("crates/host-core/src/tool_budget.rs");
const hostRpcPath = dcorePath("crates/host-core/src/rpc/mod.rs");
const skip = hostToolsPath === null
  ? "the dcore checkout is not present"
  : false;
const hostSource = (path) => (path === null ? "" : readFileSync(path, "utf8"));

const hostTools = hostSource(hostToolsPath);
const hostPermissions = hostSource(hostPermissionsPath);
const hostToolBudget = hostSource(hostToolBudgetPath);
const hostRpc = hostSource(hostRpcPath);

test("plugin completion and MCP calls fit inside the plugin tool budget", () => {
  const tool = constMs(pluginRuntime, "PLUGIN_TOOL_TIMEOUT_MS");
  assert.ok(constMs(pluginRuntime, "PLUGIN_COMPLETE_TIMEOUT_MS") < tool);
  assert.ok(constMs(pluginMcp, "MCP_CALL_TIMEOUT_MS") < tool);
});

test("host-core dispatch outlasts every Electron budget it wraps", { skip }, () => {
  const hostDispatch = constMs(hostTools, "DESKTOP_TOOL_DISPATCH_TIMEOUT_MS");
  assert.ok(constMs(pluginRuntime, "PLUGIN_TOOL_TIMEOUT_MS") < hostDispatch);
  // An `mcp_` call has no plugin-tool budget around it: it runs in Electron
  // main, which pays the lazy handshake and the whole `tools/list` traversal
  // before the call itself, all inside the same dispatch.
  const mcpLeg =
    constMs(pluginMcp, "MCP_CONNECT_TIMEOUT_MS") +
    constMs(pluginMcp, "MCP_TOOL_DISCOVERY_TIMEOUT_MS") +
    constMs(pluginMcp, "MCP_CALL_TIMEOUT_MS");
  assert.ok(mcpLeg < hostDispatch, `MCP leg ${mcpLeg}ms >= dispatch ${hostDispatch}ms`);
});

test("host-core dispatches through the shared dispatch deadline", { skip }, () => {
  // The constants can be right while the call site ignores them: this is where
  // a hard-coded 60s lived, and reverting that one line would leave every other
  // assertion in this file green.
  assert.match(
    hostRpc,
    /is_desktop_dispatched\(&p\.tool_name\)[\s\S]{0,400}?desktop_dispatch_timeout_ms\(p\.timeout_ms\)/,
    "tools.execute must dispatch desktop tools through desktop_dispatch_timeout_ms",
  );
});

test("host-core budgets match their TypeScript mirrors", { skip }, () => {
  const hostDispatch = constMs(hostTools, "DESKTOP_TOOL_DISPATCH_TIMEOUT_MS");
  assert.equal(constMs(sharedTimeouts, "DESKTOP_TOOL_DISPATCH_TIMEOUT_MS"), hostDispatch);
  assert.equal(
    constMs(sharedTimeouts, "PERMISSION_TIMEOUT_MS"),
    constMs(hostPermissions, "PERMISSION_TIMEOUT_MS"),
  );
  assert.equal(
    constMs(sharedTimeouts, "TOOL_QUEUE_WAIT_MS"),
    constMs(hostToolBudget, "TOOL_QUEUE_WAIT_MS"),
  );
});

test("the transport deadline carries every wait host-core can spend", () => {
  // The protocol cases mirrored here, expressed against the built module so it
  // runs in this repository's own suite: permission (120s)
  // + admission queue (30s) + dispatch (150s) + slack (10s) = 310s.
  assert.equal(TOOL_QUEUE_WAIT_MS, 30_000);
  assert.equal(DESKTOP_TOOL_DISPATCH_TIMEOUT_MS, 150_000);
  assert.equal(DEFAULT_DESKTOP_TOOL_RPC_TIMEOUT_MS, 310_000);
  assert.equal(rpcTimeoutMs("tools.execute", { toolName: "plugin_advisor_ask" }), 310_000);
  assert.equal(rpcTimeoutMs("tools.execute", { toolName: "mcp_github_search" }), 310_000);
  assert.equal(
    rpcTimeoutMs("tools.execute", { toolName: "plugin_advisor_ask", timeoutMs: 5_000 }),
    165_000,
  );
  assert.equal(
    rpcTimeoutMs("tools.execute", { toolName: "plugin_advisor_ask", timeoutMs: 0 }),
    310_000,
  );
  // Bash is unchanged by this: the admission queue wait is not added to it.
  assert.equal(rpcTimeoutMs("tools.execute", { toolName: "Bash" }), 190_000);
  assert.equal(rpcTimeoutMs("tools.execute", { toolName: "Bash", timeoutMs: 5_000 }), 135_000);
  assert.equal(rpcTimeoutMs("tools.execute", { toolName: "Read" }), 130_000);
});
