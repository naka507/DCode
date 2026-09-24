import assert from "node:assert/strict";
import test from "node:test";
import { nextTick, ref } from "vue";
import {
  nextSidebarTransition,
  useSidebarTransition,
} from "../src/renderer/features/app/useSidebarTransition.ts";

/**
 * The sidebar transition contract.
 *
 * `nextSidebarTransition` is the transition table the shell's animation depends
 * on, and it is asserted directly rather than through the composable: a phase
 * raised (or not raised) for the wrong input pair is the whole failure mode.
 *
 * The composable is then driven for the two ways a phase is cleared �?the
 * `animationend` the stylesheet normally produces, and the fallback timer that
 * covers a suppressed animation (reduced motion, a hidden tab).
 */

const idle = (collapsed, presented) => ({ collapsed, presented, phase: "idle" });

test("nextSidebarTransition returns the same object when nothing moved", () => {
  const previous = idle(false, true);
  assert.equal(nextSidebarTransition(previous, false, true), previous);
  assert.equal(nextSidebarTransition(previous, false, true), previous, "stable across calls");
});

test("nextSidebarTransition stays idle while the sidebar has never been presented", () => {
  // The first paint has nothing to animate from, so no phase is raised.
  const first = nextSidebarTransition(idle(true, false), false, false);
  assert.equal(first.phase, "idle");
  const revealed = nextSidebarTransition(first, false, true);
  assert.equal(revealed.phase, "idle", "becoming presented is not an expand");
});

test("nextSidebarTransition enters on expand and exits on collapse", () => {
  const expanded = nextSidebarTransition(idle(true, true), false, true);
  assert.deepEqual(expanded, { collapsed: false, presented: true, phase: "entering" });

  const collapsed = nextSidebarTransition(idle(false, true), true, true);
  assert.deepEqual(collapsed, { collapsed: true, presented: true, phase: "exiting" });
});

test("nextSidebarTransition does not animate a change that also hides the sidebar", () => {
  // Collapsing while the sidebar is being taken off screen is not an exit.
  const hidden = nextSidebarTransition(idle(false, true), true, false);
  assert.deepEqual(hidden, { collapsed: true, presented: false, phase: "idle" });
});

test("a collapse raises the exiting phase and animationend clears it", () => {
  const collapsed = ref(false);
  const presented = ref(true);
  const { sidebarEntering, sidebarExiting, handleSidebarAnimationEnd } =
    useSidebarTransition(collapsed, presented);

  assert.equal(sidebarEntering.value, false);
  assert.equal(sidebarExiting.value, false, "nothing animates before the first change");

  collapsed.value = true;
  assert.equal(sidebarExiting.value, true);
  assert.equal(sidebarEntering.value, false);

  const element = {};
  handleSidebarAnimationEnd({
    target: element,
    currentTarget: element,
    animationName: "sidebar-out",
  });
  assert.equal(sidebarExiting.value, false, "the phase is transient");
});

test("an expand raises the entering phase and only the matching animation clears it", () => {
  const collapsed = ref(true);
  const presented = ref(true);
  const { sidebarEntering, sidebarExiting, handleSidebarAnimationEnd } =
    useSidebarTransition(collapsed, presented);

  collapsed.value = false;
  assert.equal(sidebarEntering.value, true);

  const element = {};
  // A different animation on the same element must not clear the phase.
  handleSidebarAnimationEnd({
    target: element,
    currentTarget: element,
    animationName: "some-other-animation",
  });
  assert.equal(sidebarEntering.value, true, "an unrelated animation is ignored");

  // Neither must a descendant's bubbling animation.
  handleSidebarAnimationEnd({
    target: {},
    currentTarget: element,
    animationName: "sidebar-in",
  });
  assert.equal(sidebarEntering.value, true, "a bubbled animation is ignored");

  handleSidebarAnimationEnd({
    target: element,
    currentTarget: element,
    animationName: "sidebar-in",
  });
  assert.equal(sidebarEntering.value, false);
  assert.equal(sidebarExiting.value, false);
});

test("the fallback timer clears a phase whose animation never fires", async () => {
  const originalWindow = globalThis.window;
  const timers = new Map();
  let nextTimerId = 0;
  globalThis.window = {
    setTimeout(callback) {
      nextTimerId += 1;
      timers.set(nextTimerId, callback);
      return nextTimerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };

  try {
    const collapsed = ref(true);
    const presented = ref(true);
    const { sidebarExiting } = useSidebarTransition(collapsed, presented);

    collapsed.value = false;
    await nextTick();
    assert.equal(sidebarExiting.value, false, "expanding does not raise exiting");

    collapsed.value = true;
    assert.equal(sidebarExiting.value, true);
    // The phase watch is pre-flush, so the timer is armed on the next tick.
    await nextTick();
    assert.equal(timers.size, 1, "one pending fallback for the live phase");

    for (const callback of [...timers.values()]) callback();
    await nextTick();
    assert.equal(sidebarExiting.value, false, "the timer cleared the phase");
  } finally {
    // Drain queued watcher jobs before dropping the stub, or a late one calls
    // `window.setTimeout` after it is gone and the runner reports stray activity.
    await nextTick();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
