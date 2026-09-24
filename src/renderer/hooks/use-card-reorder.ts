/**
 * Pointer-driven drag-to-reorder for a list of cards.
 *
 * The hook owns transient transforms while the list itself is owned by the
 * caller; four properties are load-bearing:
 *
 *  - `items` and `busy` are read through `toValue`, because a composable runs
 *    once and has to keep reading the current value;
 *  - `busy` is read through `toValue(busy)` when the pointer is released, which
 *    is already fresh, so no ref mirror of `{ busy, move }` is needed;
 *  - `rowEvents(id)` returns named handlers rather than an object of props to
 *    spread. A Vue template binds them instead, so each handler takes the row
 *    id first and the event second, the way `use-list-reorder.ts` spells the
 *    same contract in this tree;
 *  - `tabIndex` / `aria-disabled` are attributes, not props, so the controller
 *    exposes `disabled` for the template to bind.
 *
 * Layout is read once on pointerdown, before any transform or scroll write, and
 * neighbours only repaint when the destination index actually changes.
 */
import {
  computed,
  onScopeDispose,
  ref,
  toValue,
  watch,
  type ComponentPublicInstance,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";
import { visibleNeighborMove, type ReorderPlacement } from "../lib/list-reorder";

type Row = { id: string; top: number; height: number; node: HTMLElement };

type Drag = {
  id: string;
  pointerId: number;
  index: number;
  armed: boolean;
  rows: Row[];
  cleanup: () => void;
};

export type CardReorderController = {
  draggingId: Ref<string | null>;
  /** True while the list is busy or holds fewer than two rows. */
  disabled: ComputedRef<boolean>;
  onRowKeydown: (id: string, event: KeyboardEvent) => void;
  onRowDragStart: (event: DragEvent) => void;
  onRowClickCapture: (event: MouseEvent) => void;
  onRowPointerDown: (id: string, event: PointerEvent) => void;
  rowRef: (id: string) => (node: Element | ComponentPublicInstance | null) => void;
};

export function useCardReorder(
  items: MaybeRefOrGetter<readonly { id: string }[]>,
  busy: MaybeRefOrGetter<boolean>,
  move: (id: string, target: string, placement: ReorderPlacement) => void,
): CardReorderController {
  const nodes = new Map<string, HTMLElement>();
  const draggingId = ref<string | null>(null);
  let drag: Drag | null = null;
  let suppressClick = false;
  const list = computed(() => toValue(items));
  const disabled = computed(() => toValue(busy) || list.value.length < 2);

  const cancel = () => {
    drag?.cleanup();
    drag = null;
    draggingId.value = null;
  };

  onScopeDispose(() => {
    drag?.cleanup();
  });

  /*
    A drag whose rows no longer match the list is no longer a move the user can
    see: drop it. The effect lists `items, busy`.
  */
  watch([list, () => toValue(busy)], () => {
    const current = drag;
    if (!current) return;
    if (
      toValue(busy) ||
      current.rows.length !== list.value.length ||
      current.rows.some((row, index) => row.id !== list.value[index]?.id)
    ) {
      cancel();
    }
  });

  const onRowKeydown = (id: string, event: KeyboardEvent) => {
    if (
      event.target !== event.currentTarget ||
      drag ||
      disabled.value ||
      (event.key !== "ArrowUp" && event.key !== "ArrowDown")
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const neighbor = visibleNeighborMove(
      list.value,
      id,
      event.key === "ArrowDown" ? "down" : "up",
    );
    if (neighbor) move(id, neighbor.targetId, neighbor.placement);
  };

  const onRowDragStart = (event: DragEvent) => {
    event.preventDefault();
  };

  const onRowClickCapture = (event: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const onRowPointerDown = (id: string, event: PointerEvent) => {
    suppressClick = false;
    if (disabled.value || event.button !== 0 || drag) return;
    const target = event.target as Element | null;
    if (target?.closest("button, input, select, textarea, a, [contenteditable=true]")) {
      return;
    }
    const row = event.currentTarget as HTMLElement | null;
    if (!row) return;
    // Read layout once, before any transform or scroll write.
    const rows: Row[] = [];
    for (const item of list.value) {
      const node = nodes.get(item.id);
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      rows.push({ id: item.id, top: rect.top, height: rect.height, node });
    }
    const sourceIndex = rows.findIndex((entry) => entry.id === id);
    if (sourceIndex < 0) return;
    const source = rows[sourceIndex];
    const centers = rows
      .filter((entry) => entry.id !== id)
      .map((entry) => entry.top + entry.height / 2);
    const gap = rows.length > 1 ? rows[1].top - rows[0].top - rows[0].height : 0;
    const shift = source.height + gap;
    let scrollParent: HTMLElement | null = row.parentElement;
    while (
      scrollParent &&
      !/(auto|scroll)/.test(getComputedStyle(scrollParent).overflowY)
    ) {
      scrollParent = scrollParent.parentElement;
    }
    const scrollBounds = scrollParent?.getBoundingClientRect();
    const initialScroll = scrollParent?.scrollTop ?? 0;
    const maxScroll = scrollParent
      ? Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight)
      : 0;
    const startX = event.clientX;
    const startY = event.clientY;
    let lastX = startX;
    let lastY = startY;
    let paintedX = 0;
    let paintedY = 0;
    let paintedIndex = sourceIndex;
    let frame = 0;

    const update = () => {
      const current = drag;
      if (!current?.armed) return;
      const dx = lastX - startX;
      const dy = lastY - startY + (scrollParent?.scrollTop ?? 0) - initialScroll;
      const center = source.top + source.height / 2 + dy;
      let low = 0;
      let high = centers.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (centers[middle] < center) low = middle + 1;
        else high = middle;
      }
      current.index = low;
      if (dx !== paintedX || dy !== paintedY) {
        source.node.style.transform = `translate(${dx}px, ${dy}px)`;
        paintedX = dx;
        paintedY = dy;
      }
      // Neighbours move only when the destination changes, not on every pointer event.
      if (paintedIndex !== current.index) {
        rows.forEach((entry, index) => {
          if (index === sourceIndex) return;
          const offset =
            sourceIndex < index && index <= current.index
              ? -shift
              : current.index <= index && index < sourceIndex
                ? shift
                : 0;
          const transform = offset ? `translateY(${offset}px)` : "";
          if (entry.node.style.transform !== transform) {
            entry.node.style.transform = transform;
          }
        });
        paintedIndex = current.index;
      }
    };

    const paint = () => {
      frame = 0;
      if (!drag?.armed) return;
      let scrolled = false;
      if (scrollParent && scrollBounds) {
        const edge = Math.min(40, scrollBounds.height / 4);
        const speed =
          lastY < scrollBounds.top + edge
            ? -Math.min(12, (scrollBounds.top + edge - lastY) / 3)
            : lastY > scrollBounds.bottom - edge
              ? Math.min(12, (lastY - scrollBounds.bottom + edge) / 3)
              : 0;
        const before = scrollParent.scrollTop;
        if (speed) {
          scrollParent.scrollTop = Math.max(0, Math.min(maxScroll, before + speed));
        }
        scrolled = scrollParent.scrollTop !== before;
      }
      update();
      // No permanent frame loop: stationary pointers and scroll limits become idle.
      if (scrolled) schedule();
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const onMove = (next: PointerEvent) => {
      const current = drag;
      if (!current || next.pointerId !== current.pointerId) return;
      lastX = next.clientX;
      lastY = next.clientY;
      if (!current.armed && Math.hypot(lastX - startX, lastY - startY) < 6) return;
      if (!current.armed) {
        current.armed = true;
        source.node.style.zIndex = "2";
        source.node.style.willChange = "transform";
        draggingId.value = id;
      }
      suppressClick = true;
      next.preventDefault();
      schedule();
    };

    const finish = (next: PointerEvent) => {
      const current = drag;
      if (!current || next.pointerId !== current.pointerId) return;
      // A release can arrive before the scheduled frame; consume its latest move.
      update();
      const destination = current.rows[current.index];
      const shouldMove = current.armed && current.index !== sourceIndex;
      cancel();
      if (shouldMove && !toValue(busy)) {
        move(id, destination.id, current.index > sourceIndex ? "after" : "before");
      }
    };

    const onCancel = (next: PointerEvent) => {
      if (next.pointerId === drag?.pointerId) cancel();
    };

    const onKey = (next: KeyboardEvent) => {
      if (next.key === "Escape") {
        next.preventDefault();
        cancel();
      }
    };

    const onBlur = () => cancel();

    const onScroll = (next: Event) => {
      if (!drag?.armed) return;
      if (next.target === scrollParent) {
        schedule();
      } else if (
        next.target === document ||
        (next.target instanceof Element && next.target.contains(source.node))
      ) {
        const expectedTop =
          source.top - ((scrollParent?.scrollTop ?? 0) - initialScroll) + paintedY;
        if (Math.abs(source.node.getBoundingClientRect().top - expectedTop) > 1) {
          cancel();
        }
      }
    };

    const cleanup = () => {
      cancelAnimationFrame(frame);
      rows.forEach(({ node }) => {
        node.style.removeProperty("transform");
      });
      source.node.style.removeProperty("z-index");
      source.node.style.removeProperty("will-change");
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
      window.removeEventListener("scroll", onScroll, true);
    };

    drag = {
      id,
      pointerId: event.pointerId,
      index: sourceIndex,
      armed: false,
      rows,
      cleanup,
    };
    window.addEventListener("pointermove", onMove, { capture: true, passive: false });
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    window.addEventListener("scroll", onScroll, true);
  };

  return {
    draggingId,
    disabled,
    onRowKeydown,
    onRowDragStart,
    onRowClickCapture,
    onRowPointerDown,
    rowRef: (id: string) => (node: Element | ComponentPublicInstance | null) => {
      const element =
        node instanceof Element
          ? node
          : ((node as ComponentPublicInstance | null)?.$el as Element | undefined);
      if (element instanceof HTMLElement) nodes.set(id, element);
      else nodes.delete(id);
    },
  };
}
