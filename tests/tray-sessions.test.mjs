/**
 * Tray session rows.
 *
 * The vitest suites run here now (`npm run test:unit` collects the `.test.ts`
 * files under `tests/`), but the `tray-sessions` vitest file was never carried
 * across, so this stays the executable copy: the twelve cases are re-expressed
 * here one-for-one against the module, and the sections below add the seam the
 * pure algebra cannot see — the channel names, the main-process wiring, and the
 * shell's call site.
 *
 * The cases are grouped by the function they exercise:
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IPC, IPC_WHITELIST } from "../src/shared/protocol.ts";
import {
  allocateTraySessionRows,
  buildTraySessionGroups,
  parseTraySessionPreferences,
  traySessionTitle,
  TRAY_SESSION_GROUPS,
  TRAY_SESSION_GROUP_SHARE,
  TRAY_SESSION_TITLE_COLUMNS,
  TRAY_SESSION_TOTAL_LIMIT,
} from "../src/shared/tray-sessions.ts";
import { readMainModuleSync } from "./helpers/main-source.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function session(id) {
  return {
    id,
    title: id,
    messageCount: 1,
    mode: "agent",
    thinkingLevel: "off",
    permissionMode: "inherit",
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
  };
}

function sessions(prefix, count) {
  return Array.from({ length: count }, (_, index) => session(`${prefix}-${index}`));
}

function preferences(pinned = []) {
  const sessionMeta = Object.fromEntries(pinned.map((id) => [id, { pinned: true }]));
  return { sessionMeta, archivedProjectPaths: [], sort: "recent" };
}

function notification(id, sessionId, kind, createdAt) {
  return { id, kind, sessionId, sessionTitle: sessionId, turnId: `turn-${id}`, createdAt };
}

test("the group list, shares, and budgets keep their numbers", () => {
  assert.deepEqual([...TRAY_SESSION_GROUPS], ["running", "unread", "pinned"]);
  assert.equal(TRAY_SESSION_GROUP_SHARE, 3);
  assert.equal(TRAY_SESSION_TOTAL_LIMIT, 9);
  assert.equal(TRAY_SESSION_TITLE_COLUMNS, 32);
});

test("gives a lone group the whole budget instead of only its own share", () => {
  assert.deepEqual(allocateTraySessionRows([7, 0, 0]), [7, 0, 0]);
  assert.deepEqual(allocateTraySessionRows([0, 7, 0]), [0, 7, 0]);
  assert.deepEqual(allocateTraySessionRows([0, 0, 7]), [0, 0, 7]);
});

test("caps the menu at the total budget", () => {
  assert.deepEqual(allocateTraySessionRows([12, 0, 0]), [9, 0, 0]);
  const total = allocateTraySessionRows([12, 8, 40]).reduce((sum, rows) => sum + rows, 0);
  assert.equal(total, 9);
});

test("holds the total even when the group list outgrows the per-group share", () => {
  // Four groups would claim 12 rows if each simply took its own share first.
  const limits = allocateTraySessionRows([5, 5, 5, 5]);
  assert.equal(limits.reduce((sum, rows) => sum + rows, 0), 9);
  assert.deepEqual(limits, [3, 3, 3, 0]);
});

test("keeps every group's share when all of them overflow", () => {
  assert.deepEqual(allocateTraySessionRows([5, 4, 6]), [3, 3, 3]);
  assert.deepEqual(allocateTraySessionRows([40, 40, 40]), [3, 3, 3]);
});

test("hands spare share to overflowing groups in priority order", () => {
  // Running keeps 3, takes 2 more to clear its overflow; Pinned takes the last 1.
  assert.deepEqual(allocateTraySessionRows([5, 0, 6]), [5, 0, 4]);
  // A small Running group cannot consume share it has no rows for.
  assert.deepEqual(allocateTraySessionRows([2, 10, 0]), [2, 7, 0]);
});

test("never allocates more rows than a group actually has", () => {
  assert.deepEqual(allocateTraySessionRows([1, 1, 0]), [1, 1, 0]);
  assert.deepEqual(allocateTraySessionRows([0, 0, 0]), [0, 0, 0]);
});

test("never shows fewer rows than the per-group share alone would", () => {
  for (const counts of [[7, 0, 0], [5, 4, 6], [2, 10, 0], [4, 4, 0], [1, 0, 12]]) {
    const limits = allocateTraySessionRows(counts);
    counts.forEach((count, index) =>
      assert.ok(limits[index] >= Math.min(count, TRAY_SESSION_GROUP_SHARE)),
    );
  }
});

test("shows all seven running sessions when no other group claims share", () => {
  const running = sessions("run", 7);
  const groups = buildTraySessionGroups(
    running,
    new Set(running.map((row) => row.id)),
    [],
    preferences(),
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, "running");
  assert.equal(groups[0].sessions.length, 7);
  assert.equal(groups[0].hasMore, false);
});

test("marks overflow only once the total budget is exhausted", () => {
  const running = sessions("run", 12);
  const groups = buildTraySessionGroups(
    running,
    new Set(running.map((row) => row.id)),
    [],
    preferences(),
  );
  assert.equal(groups[0].sessions.length, 9);
  assert.equal(groups[0].hasMore, true);
});

test("reclaims the empty group's share across running and pinned", () => {
  const running = sessions("run", 4);
  const pinned = sessions("pin", 4);
  const groups = buildTraySessionGroups(
    [...running, ...pinned],
    new Set(running.map((row) => row.id)),
    [],
    preferences(pinned.map((row) => row.id)),
  );
  assert.deepEqual(
    groups.map((group) => [group.kind, group.sessions.length, group.hasMore]),
    [["running", 4, false], ["pinned", 4, false]],
  );
});

test("assigns unread after running and sorts newest unread first", () => {
  const running = session("run-0");
  const unreadNewer = session("unread-new");
  const unreadOlder = session("unread-old");
  const pinned = session("pin-0");
  const notifications = [
    notification("n-new", unreadNewer.id, "task.completed", "2026-09-13T02:00:00.000Z"),
    notification("n-old", unreadOlder.id, "task.failed", "2026-09-13T01:00:00.000Z"),
  ];
  const groups = buildTraySessionGroups(
    [pinned, unreadOlder, unreadNewer, running],
    new Set([running.id]),
    notifications,
    preferences([pinned.id, running.id]),
  );
  assert.deepEqual(
    groups.map((group) => [group.kind, group.sessions.map((row) => row.id)]),
    [["running", ["run-0"]], ["unread", ["unread-new", "unread-old"]], ["pinned", ["pin-0"]]],
  );
});

test("excludes archived sessions and sessions in archived projects", () => {
  const active = session("active");
  const archivedSession = session("archived");
  const inArchivedProject = { ...session("project-archived"), projectPath: "/work/old" };
  const groups = buildTraySessionGroups(
    [active, archivedSession, inArchivedProject],
    new Set([archivedSession.id, inArchivedProject.id]),
    [],
    {
      sessionMeta: { archived: { archived: true }, active: { pinned: true } },
      archivedProjectPaths: ["/work/old"],
      sort: "recent",
    },
  );
  assert.deepEqual(groups, [
    { kind: "pinned", sessions: [{ id: "active", title: "active" }], hasMore: false },
  ]);
});

test("drops a read notification from the unread group", () => {
  const read = { ...notification("n-read", "read-0", "task.completed", "2026-09-13T03:00:00.000Z"), readAt: "2026-09-13T04:00:00.000Z" };
  const unread = notification("n-unread", "unread-0", "task.failed", "2026-09-13T02:00:00.000Z");
  const groups = buildTraySessionGroups(
    [session("read-0"), session("unread-0")],
    new Set(),
    [read, unread],
    preferences(),
  );
  assert.deepEqual(
    groups.map((group) => [group.kind, group.sessions.map((row) => row.id)]),
    [["unread", ["unread-0"]]],
  );
});

test("a project path spelled with backslashes still matches the archived spelling", () => {
  const groups = buildTraySessionGroups(
    [{ ...session("win"), projectPath: "C:\\Work\\Old" }],
    new Set(),
    [],
    { sessionMeta: {}, archivedProjectPaths: ["C:/Work/Old"], sort: "recent" },
  );
  assert.deepEqual(groups, []);
});

test("accepts extra session meta fields and rejects invalid payloads", () => {
  const parsed = parseTraySessionPreferences({
    sessionMeta: { "session-1": { pinned: true, manualTitle: true } },
    archivedProjectPaths: ["/work/app"],
    sort: "recent",
  });
  // The record is rebuilt from validated fields only, on a null-prototype map
  // so a session id can never collide with an `Object.prototype` member.
  assert.equal(Object.getPrototypeOf(parsed.sessionMeta), null);
  assert.deepEqual(
    { ...parsed, sessionMeta: { ...parsed.sessionMeta } },
    {
      sessionMeta: { "session-1": { pinned: true, archived: undefined, order: undefined } },
      archivedProjectPaths: ["/work/app"],
      sort: "recent",
    },
  );
  assert.equal(
    parseTraySessionPreferences({ sessionMeta: {}, archivedProjectPaths: [], sort: "nope" }),
    null,
  );
  assert.equal(
    parseTraySessionPreferences({
      sessionMeta: { "session-1": { order: -1 } },
      archivedProjectPaths: [],
      sort: "recent",
    }),
    null,
  );
});

test("rejects a payload that is not an object, or whose lists are not lists", () => {
  assert.equal(parseTraySessionPreferences(null), null);
  assert.equal(parseTraySessionPreferences("recent"), null);
  assert.equal(
    parseTraySessionPreferences({ sessionMeta: [], archivedProjectPaths: [], sort: "recent" }),
    null,
  );
  assert.equal(
    parseTraySessionPreferences({ sessionMeta: {}, archivedProjectPaths: "x", sort: "recent" }),
    null,
  );
  assert.equal(
    parseTraySessionPreferences({
      sessionMeta: { s: { pinned: "yes" } },
      archivedProjectPaths: [],
      sort: "recent",
    }),
    null,
  );
});

test("normalizes the archived project paths it stores", () => {
  const parsed = parseTraySessionPreferences({
    sessionMeta: {},
    archivedProjectPaths: ["C:\\Work\\Old\\"],
    sort: "recent",
  });
  assert.deepEqual(parsed?.archivedProjectPaths, ["C:/Work/Old"]);
});

test("keeps one line and leaves a title inside the column budget alone", () => {
  assert.equal(traySessionTitle(["line", "one"].join("\n"), "fallback"), "line one");
  assert.equal(traySessionTitle("   ", "fallback"), "fallback");
  assert.equal(traySessionTitle("a".repeat(32), "fallback"), "a".repeat(32));
  assert.equal(traySessionTitle("中".repeat(16), "fallback"), "中".repeat(16));
});

test("cuts a Latin title to 31 columns plus an ellipsis", () => {
  assert.equal(traySessionTitle("a".repeat(40), "fallback"), `${"a".repeat(31)}…`);
  // A cut that lands on a space never leaves it in front of the ellipsis.
  assert.equal(
    traySessionTitle(`${"a".repeat(30)} ${"b".repeat(5)}`, "fallback"),
    `${"a".repeat(30)}…`,
  );
});

test("counts a CJK character as two columns, so half as many fit", () => {
  assert.equal(traySessionTitle("中".repeat(20), "fallback"), `${"中".repeat(15)}…`);
  assert.equal(traySessionTitle(`a${"中".repeat(20)}`, "fallback"), `a${"中".repeat(15)}…`);
});

test("counts an emoji as two columns, with or without the variation selector", () => {
  assert.equal(traySessionTitle("😀".repeat(20), "fallback"), `${"😀".repeat(15)}…`);
  assert.equal(traySessionTitle("✅".repeat(20), "fallback"), `${"✅".repeat(15)}…`);
  const sun = "\u2600\ufe0f";
  assert.equal(traySessionTitle(sun.repeat(21), "fallback"), `${sun.repeat(15)}…`);
});

test("counts a combining mark as nothing and drops a joiner left by the cut", () => {
  assert.equal(traySessionTitle("e\u0301".repeat(40), "fallback"), `${"e\u0301".repeat(31)}…`);
  assert.equal(
    traySessionTitle(`${"a".repeat(29)}\u{1f468}\u200d${"b".repeat(3)}`, "fallback"),
    `${"a".repeat(29)}\u{1f468}…`,
  );
});

test("both tray channels are declared and reach the preload whitelist", () => {
  assert.equal(IPC.invoke.traySetSessionPreferences, "dcode/tray/setSessionPreferences");
  assert.equal(IPC.event.traySessionActivated, "dcode/tray/event/sessionActivated");
  assert.ok(IPC_WHITELIST.has(IPC.invoke.traySetSessionPreferences));
  assert.ok(IPC_WHITELIST.has(IPC.event.traySessionActivated));
});

test("main owns the rows and forwards the renderer's preferences through one handler", () => {
  const main = readMainModuleSync("tray-sessions.ts");
  const windowIpc = readMainModuleSync("ipc/window-ipc.ts");
  const register = readMainModuleSync("ipc/register.ts");
  const lifecycle = readMainModuleSync("bootstrap/app-lifecycle.ts");
  const index = readMainModuleSync("index.ts");

  // Main reads durable state from the host and never persists the renderer copy.
  assert.match(main, /host\.call<\{ sessions: SessionSummary\[\] \}>\("session\.list"\)/);
  assert.match(main, /host\.call<NotificationListResult>\("notification\.list", \{ limit: 200 \}\)/);
  assert.match(main, /buildTraySessionGroups\(sessions, running, inbox\.notifications, preferences\)/);
  // The menu is rebuilt only when the rows actually change.
  assert.match(main, /const nextSignature = JSON\.stringify\(next\);/);
  assert.match(main, /if \(signature === nextSignature\) return;/);

  // The renderer writes through the window registrar, which validates the payload.
  assert.match(windowIpc, /handleWithEvent\(IPC\.invoke\.traySetSessionPreferences/);
  assert.match(windowIpc, /parseTraySessionPreferences\(input\)/);
  assert.match(windowIpc, /ErrorCodes\.INVALID_ARGUMENT/);
  assert.match(register, /setTraySessionPreferences: traySessions\.setPreferences/);

  // Every renderer invoke refreshes the rows the mutation could have changed.
  assert.match(register, /traySessions\.observeInvoke\(channel\)/);
  assert.match(main, /IPC\.invoke\.sessionRename/);
  assert.match(main, /IPC\.invoke\.notificationMarkAllRead/);

  // The tray menu is built from the groups and the locale catalog.
  assert.match(lifecycle, /for \(const group of traySessions\.getGroups\(\)\)/);
  assert.match(lifecycle, /traySessionTitle\(session\.title, catalog\.chat\.untitledTask\)/);
  assert.match(lifecycle, /sendToRenderer\(IPC\.event\.traySessionActivated, \{ sessionId \}\)/);
  assert.match(index, /getRunningSessionIds: \(\) => activeTurns\.keys\(\)/);
  assert.match(index, /applicationLifecycle\?\.traySessions\.observeEvent\(channel, payload\)/);
});

test("the renderer mirrors its organization and reacts to a tray activation", () => {
  const hook = read("../src/renderer/features/app/useTraySessions.ts");
  const shell = read("../src/renderer/features/app/useAppShellRuntime.ts");
  const api = read("../src/renderer/lib/api.ts");

  assert.match(api, /setTraySessionPreferences: \(preferences: TraySessionPreferences\) =>/);
  assert.match(api, /invoke<\{ ok: boolean \}>\(IPC\.invoke\.traySetSessionPreferences, preferences\)/);
  assert.match(api, /onTraySessionActivated: \(listener: \(sessionId: string \| null\) => void\)/);
  assert.match(api, /window\.dcode\.on\(IPC\.event\.traySessionActivated/);

  // One IPC write per burst: the microtask coalescing is the whole point.
  assert.match(hook, /if \(scheduled\) return;/);
  assert.match(hook, /queueMicrotask\(\(\) => \{/);
  // The legacy manual setting is presented as recent order.
  assert.match(hook, /state\.sessionView\.sort === "manual" \? "recent" : state\.sessionView\.sort/);
  assert.match(hook, /archivedProjectPaths: Object\.entries\(state\.projectMeta\)/);
  assert.match(hook, /onScopeDispose\(\(\) => \{/);

  // The shell supplies its own search/sidebar gestures, so a tray click lands
  // exactly like the in-app one.
  assert.match(shell, /useTraySessions\(\{ setSearchOpen, reopenSidebar \}\)/);
});

test("both locales name every tray group and the overflow row", () => {
  const en = read("../src/i18n/locales/en/index.ts");
  const zh = read("../src/i18n/locales/zh-CN/index.ts");
  for (const source of [en, zh]) {
    const block = source.slice(source.indexOf("  tray: {"));
    const end = block.indexOf("\n  },");
    const tray = block.slice(0, end);
    for (const key of ["running", "unread", "pinned", "viewMore"]) {
      assert.match(tray, new RegExp(`^    ${key}: `, "m"));
    }
  }
  // The group keys are the ones the menu reads, not decorative names.
  assert.match(en, /^    running: "Running",$/m);
  assert.match(zh, /^    running: "运行中",$/m);
});
