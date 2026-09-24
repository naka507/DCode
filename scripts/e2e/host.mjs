import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { readNdjsonLines } from "../../src/shared/ndjson.ts";
import { assert, shortJson } from "./assert.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function hostBinaryCandidates() {
  const names =
    process.platform === "win32"
      ? ["DCore.exe", "DCore"]
      : ["DCore"];
  const candidates = [];
  const configured = process.env.DCODE_HOST_BIN;
  if (configured) {
    const configuredPath = resolve(configured);
    candidates.push(configuredPath);
    if (
      process.platform === "win32" &&
      !configuredPath.toLowerCase().endsWith(".exe")
    ) {
      candidates.push(configuredPath + ".exe");
    }
  }
  for (const name of names) {
    candidates.push(join(root, "target", "debug", name));
    candidates.push(join(root, "..", "..", "..", "target", "debug", name));
    // host-core is not built inside this repository. It is the
    // sibling `dcore` checkout, which is also where `src/main/host-process.ts`
    // resolves the binary from, and where electron-builder's `extraResources`
    // copies it from. Without these entries every runner that calls
    // `resolveHostBinary()` needs a hand-set `DCODE_HOST_BIN`, which is
    // what the shared driver exists to avoid.
    //
    // Two levels, because this driver also runs from a task worktree: the
    // primary checkout sits beside `dcore` (`../dcore`), while
    // `../dcode-worktrees/<task>` is two levels down (`../../dcore`). That is
    // the same pair `tests/helpers/sibling-repos.mjs` resolves.
    for (const dcore of [join(root, "..", "dcore"), join(root, "..", "..", "dcore")]) {
      for (const profile of ["debug", "release"]) {
        candidates.push(join(dcore, "target", profile, name));
      }
    }
  }
  return candidates;
}

export function resolveHostBinary() {
  const candidates = hostBinaryCandidates();
  const binary = candidates.find((candidate) => existsSync(candidate));
  if (!binary) {
    throw new Error(
      "host binary missing; set DCODE_HOST_BIN. Tried: " + candidates.join(", "),
    );
  }
  return resolve(binary);
}

function rpcErrorFromWire(wire, method) {
  const error = new Error(method + ": " + (wire?.message || shortJson(wire)));
  error.errorCode = wire?.data?.errorCode;
  error.rpc = wire;
  return error;
}

function failPending(pending, error) {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pending.clear();
}

export class Host {
  constructor(binary, dataDir) {
    this.binary = binary;
    this.dataDir = dataDir;
    this.child = null;
    this.stdoutReader = null;
    this.pending = new Map();
    this.notifications = [];
    this.stderr = "";
    this.exited = false;
    this.exitPromise = Promise.resolve();
  }

  async start(protocolVersion = 11) {
    if (this.child) throw new Error("host is already running");
    this.pending = new Map();
    this.notifications = [];
    this.stderr = "";
    this.exited = false;
    const child = spawn(this.binary, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, DCODE_DATA_DIR: this.dataDir },
    });
    this.child = child;
    this.exitPromise = new Promise((resolveExit) => {
      child.once("exit", (code, signal) => {
        this.exited = true;
        const suffix = this.stderr.trim()
          ? " stderr=" + this.stderr.trim().slice(-500)
          : "";
        failPending(
          this.pending,
          new Error(
            "host exited code=" + code + " signal=" + (signal || "none") + suffix,
          ),
        );
        resolveExit({ code, signal });
      });
    });
    child.on("error", (error) => {
      failPending(this.pending, error);
    });
    child.stderr.on("data", (chunk) => {
      this.stderr += String(chunk);
      if (process.env.DEBUG_HOST) process.stderr.write(chunk);
    });
    this.stdoutReader = readNdjsonLines(child.stdout, (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        if (process.env.DEBUG_HOST) console.error("host non-JSON stdout: " + line);
        return;
      }
      if (message.id !== undefined && message.id !== null) {
        const entry = this.pending.get(String(message.id));
        if (!entry) return;
        this.pending.delete(String(message.id));
        clearTimeout(entry.timer);
        if (message.error) entry.reject(rpcErrorFromWire(message.error, entry.method));
        else entry.resolve(message.result);
        return;
      }
      if (message.method) {
        this.notifications.push(message);
        if (this.notifications.length > 2_000) this.notifications.shift();
      }
    });

    const handshake = await this.call(
      "app.handshake",
      { protocolVersion },
      45_000,
    );
    assert(
      handshake?.protocolVersion === protocolVersion,
      "handshake protocol mismatch: " + shortJson(handshake),
    );
    return handshake;
  }

  call(method, params = {}, timeoutMs = 30_000) {
    if (!this.child || this.exited) {
      return Promise.reject(new Error("host is not running for " + method));
    }
    const id = randomUUID();
    return new Promise((resolveResult, rejectResult) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        rejectResult(new Error("timeout " + method + " after " + timeoutMs + "ms"));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: resolveResult,
        reject: rejectResult,
        timer,
      });
      try {
        this.child.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectResult(error);
      }
    });
  }

  clearNotifications() {
    this.notifications = [];
  }

  matchingNotifications(method, predicate = () => true) {
    return this.notifications.filter(
      (note) => note.method === method && predicate(note),
    );
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    failPending(this.pending, new Error("host stopped by harness"));
    try {
      child.kill();
    } catch {
      // The exit event below is the authoritative cleanup signal.
    }
    await Promise.race([this.exitPromise, delay(3_000)]);
    if (!this.exited) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Best effort on platforms without SIGKILL semantics.
      }
      await Promise.race([this.exitPromise, delay(3_000)]);
    }
    this.stdoutReader?.close();
    this.stdoutReader = null;
    this.child = null;
    if (!this.exited) throw new Error("host did not exit during cleanup");
  }

  async restart(protocolVersion = 11) {
    await this.stop();
    await this.start(protocolVersion);
  }
}
