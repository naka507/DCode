/**
 * Notification inbox filtering.
 *
 * The module under test lives at `src/renderer/lib/notification-inbox.ts`;
 * its two exports are unchanged, so the two pure-function cases are direct.
 *
 * The third case is a source contract on
 * `src/renderer/components/NotificationCenter.vue`, which still filters the
 * stored list through both helpers, but through Vue `computed` wrappers, so
 * the plain call `inboxNotifications(storedNotifications)` becomes
 * `inboxNotifications(storedNotifications.value)`. The negative assertion
 * (`state.unreadNotificationCount` is not read by the component) is kept
 * as-is: the store field still exists and must still not be what the popover
 * counts from.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  inboxNotifications,
  inboxUnreadCount,
} from "../src/renderer/lib/notification-inbox.ts";

const componentSource = await readFile(
  new URL("../src/renderer/components/NotificationCenter.vue", import.meta.url),
  "utf8",
);

function notification(overrides) {
  return {
    id: "notification-1",
    kind: "task.completed",
    sessionId: "session-1",
    sessionTitle: "Session",
    turnId: "turn-1",
    createdAt: "2026-09-04T10:00:00.000Z",
    readAt: null,
    ...overrides,
  };
}

test("inbox hides successful completions and keeps failures in order", () => {
  const rows = inboxNotifications([
    notification({ id: "done-1" }),
    notification({ id: "failed-1", kind: "task.failed" }),
    notification({ id: "done-2", readAt: "2026-09-04T10:01:00.000Z" }),
    notification({ id: "failed-2", kind: "task.failed", readAt: "2026-09-04T10:02:00.000Z" }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["failed-1", "failed-2"],
  );
});

test("inbox unread count ignores unread completions", () => {
  assert.equal(
    inboxUnreadCount([
      notification({ id: "done-1" }),
      notification({ id: "done-2" }),
      notification({ id: "failed-1", kind: "task.failed" }),
      notification({ id: "failed-2", kind: "task.failed", readAt: "2026-09-04T10:02:00.000Z" }),
    ]),
    1,
  );
  assert.equal(inboxUnreadCount([notification({ id: "done-1" })]), 0);
});

test("notification center renders the filtered inbox instead of the raw store", () => {
  assert.match(componentSource, /inboxNotifications\(storedNotifications\.value\)/);
  assert.match(componentSource, /inboxUnreadCount\(storedNotifications\.value\)/);
  assert.doesNotMatch(componentSource, /state\.unreadNotificationCount/);
});
