#!/usr/bin/env node
/**
 * E2E-CHROME-window-controls-survive-work-panel.
 *
 * Window controls must remain visible and hit-testable through the real
 * work-panel flow, on every pane state the shell can reach. Uses a throwaway
 * profile and data directory with one local session; no real provider calls.
 * Platform CSS emulation is explicitly not native macOS/Linux qualification.
 *
 * Every probe in this runner is inline — it has no driver of its own.
 * `assertDesktopBuild()` / `resolveElectronBinary()` resolve `appDir` to the
 * repository root, which is the layout `scripts/e2e/boot.mjs` assumes too.
 *
 * Two places are deliberately stronger than a naive probe, both because such
 * a probe can report a pass for a state it never reached:
 *
 *   1. Every transition the labels name is awaited (`waitForPanel` /
 *      `waitForSidebar`). Clicking and asserting straight away is not enough:
 *      a click on a *disabled* toggle dispatches nothing at all, so "panel
 *      reopened after settings" could pass with the panel still closed —
 *      `checkControls` only inspects the window controls, which are reachable
 *      either way.
 *   2. The teardown is bounded. The last step leaves the app hidden-but-running
 *      on purpose (close-to-tray), so an unbounded wait on its exit would hang
 *      the runner instead of failing it and leak the temp directory.
 *
 * The `.app-shell:has(> .work-panel) > .window-controls` override in
 * `styles/chrome.css` is what makes `checkControls`' background comparison hold
 * while the panel is open; `tests/window-controls-runner.test.mjs` pins it.
 *
 * Prereqs: `npm run build` (`electron-vite build`) and a host-core
 * binary. `resolveHostBinary()` finds it in `../dcore/target/{debug,release}`,
 * or `DCODE_HOST_BIN` overrides it.
 *
 * Optional screenshots are written only to `DCODE_CHROME_ARTIFACT_DIR`.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  assertDesktopBuild,
  repositoryRoot,
  resolveElectronBinary,
} from "./e2e/boot.mjs";
import { Host, resolveHostBinary } from "./e2e/host.mjs";

const root = repositoryRoot();
const { appDir } = assertDesktopBuild(root);
const { electronBinary } = resolveElectronBinary(root);
const binary = resolveHostBinary();
const temp = await mkdtemp(join(tmpdir(), "pi-window-controls-"));
const port = Number(process.env.DCODE_CHROME_CDP_PORT || 9347);
const pending = new Map();
let sequence = 0;
let socket;
let child;
let output = "";
let failed = false;

// Print the host the run will use. A stale host-core fails opaquely — a
// protocol-old binary dies at the handshake, and a schema-old one surfaces as
// missing-field errors inside the app that read like renderer bugs — so the
// path is the first thing a failure should be attributable to.
console.log(`host-core: ${binary}`);
console.log(`electron:  ${electronBinary}`);

async function waitFor(predicate, label) {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}

/**
 * The work panel's own presence, as a predicate the transitions can await.
 * `checkControls` cannot stand in for this: the window controls are reachable
 * with the panel open or closed, so asserting them says nothing about whether
 * the click that was supposed to open the panel did anything.
 */
const panelOpen = () => evaluate(`!!document.querySelector('.work-panel')`);
const panelClosed = () => evaluate(`!document.querySelector('.work-panel')`);
const panelMaximized = () =>
  evaluate(`!!document.querySelector('.work-panel-maximized')`);

/**
 * The sidebar's expanded state. `.sidebar` is kept mounted through its exit
 * animation, so the class list — not mere presence — is the signal, and the
 * transition table's own `is-entering` / `is-exiting` states are excluded.
 */
const sidebarExpanded = () =>
  evaluate(
    `(() => {
      const el = document.querySelector('.sidebar');
      return !!el && !el.classList.contains('is-exiting');
    })()`,
  );

function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolveResult, rejectResult) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectResult(new Error(`CDP timeout: ${method}`));
    }, 15_000);
    pending.set(id, { resolve: resolveResult, reject: rejectResult, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

/**
 * Wait for every finite animation to finish, so a check never measures a
 * mid-flight frame. Infinite animations (the running indicator) are excluded:
 * awaiting one would hang the runner.
 */
async function settle() {
  await evaluate(`(async () => {
    await new Promise(requestAnimationFrame);
    await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => {})));
    await new Promise(requestAnimationFrame);
  })()`);
}

/**
 * A trusted pointer click, so the app's own hit testing and the element's click
 * path both run. The target must be the topmost element at its own centre:
 * a covered control is exactly the defect this runner exists to catch.
 */
async function click(selector, waitForPaint = true) {
  const point = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('Missing target: ' + ${JSON.stringify(selector)});
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (!el.contains(document.elementFromPoint(x, y))) throw new Error('Obscured target: ' + ${JSON.stringify(selector)} + ' by ' + document.elementFromPoint(x, y)?.className);
    return { x, y };
  })()`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", {
      type,
      ...point,
      button: "left",
      clickCount: 1,
    });
  }
  if (waitForPaint) await settle();
}

/**
 * The three renderer-drawn controls, measured where they actually paint. macOS
 * keeps its native traffic lights, so the band must be absent there; on
 * Windows/Linux it must hold exactly three visible, reachable buttons.
 */
async function checkControls(label) {
  const result = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.window-control-btn')];
    const band = document.querySelector('.window-controls');
    const header = document.querySelector('.work-panel-header');
    if (band && header && getComputedStyle(band).backgroundColor !== getComputedStyle(header).backgroundColor)
      throw new Error('Window-control background differs from the adjacent panel header');
    return buttons.map(el => {
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { label: el.getAttribute('aria-label'), visible: r.width > 0 && r.height > 0 &&
        x >= 0 && x < innerWidth && y >= 0 && y < innerHeight,
        reachable: el.contains(document.elementFromPoint(x, y)) };
    });
  })()`);
  const ok =
    process.platform === "darwin"
      ? result.length === 0
      : result.length === 3 && result.every((row) => row.visible && row.reachable);
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${JSON.stringify(result)}`);
  if (
    (!ok || label === "panel opened") &&
    process.env.DCODE_CHROME_ARTIFACT_DIR
  ) {
    const dir = resolve(process.env.DCODE_CHROME_ARTIFACT_DIR);
    await mkdir(dir, { recursive: true });
    const shot = await send("Page.captureScreenshot");
    await writeFile(
      join(
        dir,
        ok ? "window-controls-fixed.png" : "window-controls-failure.png",
      ),
      Buffer.from(shot.data, "base64"),
    );
  }
  assert.ok(ok, label);
}

try {
  // Seed one local session through the host protocol, then stop the host: the
  // app spawns its own, and this pass exists only to give the renderer
  // something to activate.
  const host = new Host(binary, join(temp, "data"));
  let sessionId;
  try {
    await host.start();
    await host.call("workspace.set", { path: temp });
    const { session } = await host.call("session.create", {
      title: "Window controls regression",
    });
    sessionId = session.id;
  } finally {
    await host.stop();
  }

  const env = {
    ...process.env,
    DCODE_DATA_DIR: join(temp, "data"),
    DCODE_HOST_BIN: binary,
    DCODE_START_MAXIMIZED: "0",
    // Force the built renderer rather than a dev server, which an empty
    // ELECTRON_RENDERER_URL selects.
    ELECTRON_RENDERER_URL: "",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(
    electronBinary,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${join(temp, "profile")}`,
      ".",
    ],
    { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (data) => {
    output = (output + data).slice(-4000);
  });
  child.stderr.on("data", (data) => {
    output = (output + data).slice(-4000);
  });

  let target;
  await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1000),
      });
      target = (await response.json()).find(
        (candidate) =>
          candidate.type === "page" &&
          candidate.url.includes("out/renderer/index.html") &&
          !candidate.url.includes("surface="),
      );
      return !!target;
    } catch {
      return false;
    }
  }, "renderer target");

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.onopen = resolveOpen;
    socket.onerror = rejectOpen;
  });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  };

  await waitFor(
    () =>
      evaluate(
        `!!document.querySelector('.main-pane') && !document.querySelector('.startup-splash')`,
      ),
    "ready shell",
  );
  await evaluate(
    `window.__DCODE__.selectSession(${JSON.stringify(sessionId)})`,
  );
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('.app-work-panel-toggle')?.disabled === false`,
      ),
    "active session",
  );
  await settle();

  await checkControls("panel closed");
  await click(".app-work-panel-toggle");
  await waitFor(panelOpen, "panel opened");
  await settle();
  await checkControls("panel opened");

  // CSS emulation proves the renderer's own band geometry across platforms; it
  // deliberately does not qualify another operating system's native UI.
  if (process.platform !== "darwin") {
    for (const platform of ["win32", "linux"]) {
      for (const theme of ["light", "dark"]) {
        await evaluate(`document.documentElement.dataset.platform = ${JSON.stringify(platform)};
          window.__DCODE__.setThemeAttr(${JSON.stringify(theme)})`);
        await settle();
        await checkControls(`${platform}/${theme} CSS with panel open (emulated)`);
      }
    }
    await evaluate(
      `document.documentElement.dataset.platform = ${JSON.stringify(process.platform)}`,
    );
  }

  // The sidebar's expanded state is read from the class list, not from the
  // element's presence: `.sidebar` stays mounted through its exit animation.
  const wasExpanded = await sidebarExpanded();
  await click('[data-nav="toggle-sidebar"]');
  await waitFor(
    async () => (await sidebarExpanded()) !== wasExpanded,
    "sidebar toggled with panel open",
  );
  await checkControls("sidebar toggled with panel open");

  await click(".work-panel-maximize");
  await waitFor(panelMaximized, "panel maximized");
  await checkControls("panel maximized");

  const wasExpandedInPreview = await sidebarExpanded();
  await click('[data-nav="toggle-sidebar"]');
  await waitFor(
    async () => (await sidebarExpanded()) !== wasExpandedInPreview,
    "sidebar toggled with panel maximized",
  );
  await checkControls("sidebar toggled with panel maximized");

  await click(".work-panel-maximize");
  await waitFor(
    async () => !(await panelMaximized()),
    "panel restored",
  );
  await checkControls("panel restored");

  await evaluate(
    `window.dcode.invoke('dcode/menu/nativeAction', {action:'toggleFullScreen'})`,
  );
  await waitFor(
    () =>
      evaluate(
        `window.dcode.invoke('dcode/menu/nativeAction', {action:'restoreMainWindow'}).then(s => s.ok && s.data.fullScreen)`,
      ),
    "native fullscreen",
  );
  await settle();
  await checkControls("native fullscreen with panel open");

  await evaluate(
    `window.dcode.invoke('dcode/menu/nativeAction', {action:'toggleFullScreen'})`,
  );
  await waitFor(
    () =>
      evaluate(
        `window.dcode.invoke('dcode/menu/nativeAction', {action:'restoreMainWindow'}).then(s => s.ok && !s.data.fullScreen)`,
      ),
    "leave native fullscreen",
  );
  await settle();

  if (process.platform !== "darwin") {
    await click(".window-control-btn:nth-child(2)");
    await waitFor(
      () =>
        evaluate(
          `window.dcode.invoke('dcode/window/control', {action:'getState'}).then(s => s.ok && s.data.maximized)`,
        ),
      "native window maximized",
    );
    await checkControls("native window maximized with panel open");

    await click(".window-control-btn:nth-child(2)");
    await waitFor(
      () =>
        evaluate(
          `window.dcode.invoke('dcode/window/control', {action:'getState'}).then(s => s.ok && !s.data.maximized)`,
        ),
      "native window restored",
    );
  }

  await click(".app-work-panel-toggle");
  await waitFor(panelClosed, "panel closed again");
  await checkControls("panel closed again");

  await evaluate(`window.__DCODE__.setPage('settings')`);
  await waitFor(
    () => evaluate(`!!document.querySelector('.settings-mode')`),
    "settings opened",
  );
  await settle();
  await checkControls("settings route");

  await evaluate(`window.__DCODE__.setPage('chat')`);
  // Settings owns the whole window, so returning to chat leaves the panel
  // closed; the click has to actually reopen it. Asserting the window controls
  // straight after the click is not enough: those are reachable with the
  // panel closed, so that check would pass whether the panel reopened or not.
  await evaluate(`window.__DCODE__.setPage('chat')`);
  await waitFor(
    () => evaluate(`!!document.querySelector('.main-pane')`),
    "chat route restored",
  );
  await settle();
  await click(".app-work-panel-toggle");
  await waitFor(panelOpen, "panel reopened after settings");
  await settle();
  await checkControls("panel reopened after settings");

  if (process.platform !== "darwin") {
    await click(".window-control-btn:first-child", false);
    await waitFor(
      () => evaluate(`document.visibilityState === 'hidden'`),
      "native minimize",
    );
    await evaluate(
      `window.dcode.invoke('dcode/menu/nativeAction', {action:'toggleMainWindow'})`,
    );
    await waitFor(
      () => evaluate(`document.visibilityState === 'visible'`),
      "native window shown",
    );
    await settle();
    await checkControls("restored after native minimize");

    // Configure only the disposable profile, so close-to-tray can be observed
    // without leaving a blocking native confirmation dialog on the test runner.
    await evaluate(
      `window.dcode.invoke('dcode/window/closeBehavior/set', {behavior:'tray'})`,
    );
    await click(".window-control-close", false);
    await waitFor(
      () => evaluate(`document.visibilityState === 'hidden'`),
      "native close-to-tray",
    );
    console.log("PASS native minimize and close actions");
  }

  console.log(`PASS native ${process.platform} window-control flow`);
} catch (error) {
  failed = true;
  console.error(error);
  console.error(output);
} finally {
  socket?.close();
  for (const entry of pending.values()) clearTimeout(entry.timer);
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill();
    // Bounded: the last step deliberately leaves the app hidden-but-running
    // (close-to-tray), and a `will-quit` handler that never returns would
    // otherwise hang the runner forever instead of failing it — and skip the
    // temp-directory cleanup below, leaking it.
    const exitedInTime = await Promise.race([
      exited.then(() => true),
      delay(30_000).then(() => false),
    ]);
    if (!exitedInTime) {
      console.error("electron did not exit within 30s of SIGTERM");
      failed = true;
      child.kill("SIGKILL");
      await Promise.race([exited, delay(10_000)]);
    }
  }
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

process.exitCode = failed ? 1 : 0;
