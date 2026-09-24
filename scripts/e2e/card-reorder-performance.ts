/**
 * Card-reorder work budget for the Vue renderer.
 *
 * The fixture mounts the real `useCardReorder` composable with a controlled
 * animation clock and counts work directly. Three details, none of which relaxes
 * a bound:
 *
 *  1. **`renders` counts the Vue render function**: one call per commit of the
 *     list component.
 *  2. **The commit is `await nextTick()`.** The only reactive write in the drag
 *     path is `draggingId`, set once when the drag arms; Vue batches it into one
 *     job, so the burst is flushed with a single `nextTick` instead of one
 *     synchronous commit per event. The rAF callbacks need no flush at all —
 *     they write DOM style directly.
 *  3. **`root.unmount()` is `app.unmount()`**, which runs the component scope's
 *     `onScopeDispose` and therefore releases the drag listeners. The app is
 *     mounted into a wrapper inside the measured `host`, so the rows live in the
 *     element the probe sizes and scrolls.
 *
 * The bounds: at most one render for a 200-event pointer
 * burst, no render and no geometry read while the pointer is stationary, no
 * retained animation callback once the pointer stops, at most one move with the
 * final destination when the release lands before the scheduled frame, automatic
 * scrolling never extended past the original content, and no callback left behind
 * by unmount.
 */
import { createApp, defineComponent, h, nextTick } from "vue";
import { useCardReorder } from "../../src/renderer/hooks/use-card-reorder";

type Move = { id: string; target: string; placement: string };

/** Count work with a controlled animation clock; do not depend on machine speed. */
export async function cardReorderPerformance() {
  const items = Array.from({ length: 200 }, (_, index) => ({ id: String(index) }));
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;overflow:hidden";
  document.body.append(host);
  let renders = 0;
  const moves: Move[] = [];
  let geometryReads = 0;
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const realFrame = window.requestAnimationFrame;
  const realCancel = window.cancelAnimationFrame;
  const realRect = Element.prototype.getBoundingClientRect;
  window.requestAnimationFrame = (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  Element.prototype.getBoundingClientRect = function (this: Element) {
    geometryReads += 1;
    return realRect.call(this);
  };
  const tick = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(performance.now());
  };
  /*
    One style object for every row, for the whole run. Vue's `patchProps` calls
    `hostPatchProp` only when `next !== prev`, so a shared object keeps every
    commit from re-patching all 200 rows' styles — which is what a work-budget
    probe should not be paying for. A fresh `{ height: "24px" }` per render would
    pass that guard and patch every row on every commit.
  */
  const rowStyle = { height: "24px" };
  const Fixture = defineComponent({
    name: "CardReorderPerformanceFixture",
    setup() {
      const reorder = useCardReorder(items, false, (id, target, placement) => {
        moves.push({ id, target, placement });
      });
      // One ref callback per row for the whole run. `useCardReorder`'s `rowRef`
      // returns a fresh arrow every call, and `setRef` re-invokes the callback
      // whenever `oldRef !== ref` — so a fresh closure per render would re-run
      // 200 callbacks per commit, which the work budget is meant to exclude.
      const refs = new Map<string, (node: unknown) => void>();
      const rowRef = (id: string) => {
        const existing = refs.get(id);
        if (existing) return existing;
        const created = reorder.rowRef(id) as (node: unknown) => void;
        refs.set(id, created);
        return created;
      };
      return () => {
        renders += 1;
        return h(
          "ul",
          items.map(({ id }) =>
            h(
              "li",
              {
                key: id,
                ref: rowRef(id),
                style: rowStyle,
                tabIndex: reorder.disabled.value ? -1 : 0,
                "aria-disabled": reorder.disabled.value,
                onKeydown: (event: KeyboardEvent) =>
                  reorder.onRowKeydown(id, event),
                onDragstart: reorder.onRowDragStart,
                onClickCapture: reorder.onRowClickCapture,
                onPointerdown: (event: PointerEvent) =>
                  reorder.onRowPointerDown(id, event),
              },
              id,
            ),
          ),
        );
      };
    },
  });
  const app = createApp(Fixture);
  app.config.errorHandler = (error) => {
    console.error("CARD_REORDER_PERFORMANCE_RENDER_ERROR", error);
  };
  let mounted = false;
  try {
    // Mounted into a wrapper inside `host`, not into a detached container: the
    // rows have to live in the element the probe measures and scrolls. The
    // wrapper is a plain div, so `host` is still the scroll container the drag
    // finds when it walks up for `overflow-y: auto`.
    const container = document.createElement("div");
    host.append(container);
    app.mount(container);
    mounted = true;
    await nextTick();
    const row = host.querySelector("li")!;
    const bounds = row.getBoundingClientRect();
    row.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 80,
        button: 0,
        clientX: bounds.left + 10,
        clientY: bounds.top + 10,
        bubbles: true,
      }),
    );
    const readsAtStart = geometryReads;
    const rendersAtStart = renders;
    for (let index = 0; index < 200; index += 1) {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 80,
          clientX: bounds.left + 30 + index,
          clientY: bounds.top + 80,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
    // One tick for the batched `draggingId` write the burst produced.
    await nextTick();
    tick();
    const rendersAfterBurst = renders;
    for (let index = 0; index < 120; index += 1) tick();
    const result = {
      cards: items.length,
      pointerEvents: 200,
      burstRenders: rendersAfterBurst - rendersAtStart,
      idleRenders: renders - rendersAfterBurst,
      geometryReadsAfterStart: geometryReads - readsAtStart,
      pendingIdleFrames: frames.size,
    };
    window.dispatchEvent(
      new PointerEvent("pointercancel", { pointerId: 80, bubbles: true }),
    );
    if (frames.size) {
      throw new Error("cancelled drag retained animation callbacks");
    }
    if (
      result.burstRenders > 1 ||
      result.idleRenders !== 0 ||
      result.pendingIdleFrames !== 0 ||
      result.geometryReadsAfterStart !== 0
    ) {
      throw new Error(
        `drag preview exceeded its work budget: ${JSON.stringify(result)}`,
      );
    }
    // Release before the queued frame still commits the last pointer position.
    const destination = host.querySelectorAll("li")[4].getBoundingClientRect();
    row.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 81,
        button: 0,
        clientX: bounds.left + 10,
        clientY: bounds.top + 10,
        bubbles: true,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 81,
        clientX: bounds.left + 30,
        clientY: destination.bottom - 1,
        bubbles: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 81, bubbles: true }),
    );
    if (
      moves.length !== 1 ||
      moves[0].id !== "0" ||
      moves[0].target !== "4" ||
      moves[0].placement !== "after" ||
      frames.size
    ) {
      throw new Error(
        "release before paint lost the final destination or retained a callback",
      );
    }
    if (
      [...host.querySelectorAll<HTMLElement>("li")].some(
        (node) => node.style.transform,
      )
    ) {
      throw new Error("release left transient transforms behind");
    }
    host.style.overflowY = "auto";
    host.style.height = "200px";
    host.style.bottom = "auto";
    const scrollLimit = host.scrollHeight - host.clientHeight;
    host.scrollTop = scrollLimit;
    const lastRow = host.querySelectorAll("li")[199];
    const lastBounds = lastRow.getBoundingClientRect();
    const viewport = host.getBoundingClientRect();
    lastRow.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 83,
        button: 0,
        clientX: lastBounds.left + 10,
        clientY: lastBounds.top + 5,
        bubbles: true,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 83,
        clientX: lastBounds.left + 30,
        clientY: viewport.bottom + 30,
        bubbles: true,
        cancelable: true,
      }),
    );
    for (let index = 0; index < 10; index += 1) tick();
    if (host.scrollTop !== scrollLimit || frames.size) {
      throw new Error(
        "drag transforms extended automatic scrolling beyond the original content",
      );
    }
    window.dispatchEvent(
      new PointerEvent("pointercancel", { pointerId: 83, bubbles: true }),
    );
    row.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 82,
        button: 0,
        clientX: bounds.left + 10,
        clientY: bounds.top + 10,
        bubbles: true,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 82,
        clientX: bounds.left + 30,
        clientY: destination.bottom - 1,
        bubbles: true,
        cancelable: true,
      }),
    );
    mounted = false;
    app.unmount();
    if (frames.size) throw new Error("unmount retained an animation callback");
    return result;
  } finally {
    if (mounted) app.unmount();
    window.requestAnimationFrame = realFrame;
    window.cancelAnimationFrame = realCancel;
    Element.prototype.getBoundingClientRect = realRect;
    host.remove();
  }
}
