import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dcorePath } from "./helpers/sibling-repos.mjs";

const electronProxy = await readFile(
  new URL("../src/main/network-proxy.ts", import.meta.url),
  "utf8",
);
const sidecarSource = await readFile(
  new URL("../src/agent/runtime/sidecar.ts", import.meta.url),
  "utf8",
);
const nodeProxy = await readFile(
  new URL("../src/agent/runtime/node-proxy.ts", import.meta.url),
  "utf8",
);
const hostProcess = await readFile(
  new URL("../src/engine/host-process.ts", import.meta.url),
  "utf8",
);

// host-core is the Rust crate in the sibling dcore checkout, so the proxy
// contract that spans both languages skips rather than fails when it is absent.
const hostProxyPath = dcorePath("crates/host-core/src/network_proxy.rs");
const skip =
  hostProxyPath === null ? "needs the dcore checkout beside dcode" : false;
const hostProxy = skip ? "" : await readFile(hostProxyPath, "utf8");

test("Electron main applies Chromium proxy and net.fetch", () => {
  assert.match(electronProxy, /ses\.setProxy\(config\)/);
  assert.match(electronProxy, /net\.fetch\.bind\(net\)/);
  assert.match(electronProxy, /session-created/);
  assert.match(electronProxy, /dcode\/network\/testProxy|PROXY_TEST_URL/);
  assert.match(electronProxy, /DCODE_PROXY_JSON/);
  assert.match(electronProxy, /startAuthenticatedProxyRelay/);
  assert.match(electronProxy, /proxyHasCredentials/);
});

test("sidecar reconfigures undici without a restart", () => {
  assert.match(sidecarSource, /applyNodeNetworkProxy/);
  assert.match(sidecarSource, /sidecar\.configure/);
  assert.match(nodeProxy, /ProxyAgent/);
  assert.match(nodeProxy, /socks5Connect/);
  assert.match(nodeProxy, /setGlobalDispatcher/);
});

test("host-core curl uses --proxy and Bash does not inherit env", { skip }, () => {
  assert.match(hostProxy, /curl_proxy_args/);
  assert.match(hostProxy, /"--proxy"/);
  assert.match(hostProcess, /stripProxyEnv\(process\.env\)/);
});
