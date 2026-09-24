/**
 * Pan/drag behaviour for the composer image preview.
 *
 * The `useImagePreviewPan` composable. Every
 * change is mechanical:
 *
 *   - `useState` -> `ref`, and `offset` (recomputed as
 *     `clamp(position)` on every render) -> `computed`.
 *   - `useRef` -> a plain `let` binding. Neither `drag` nor `suppressClick`
 *     renders anything, and they only carry state between
 *     pointer events on the same tick — the same call `useComposerAttachments`
 *     makes for its non-reactive cells.
 * - `useLayoutEffect(., [id, src])` -> `watch([id, src], ., { flush:
 *     "post", immediate: true })`, which runs after the DOM update and before
 *     paint — the window measured in — plus `onScopeDispose` for
 *     the `release` cleanup.
 *   - `bounds` was a fresh object per render, so it is a `MaybeRefOrGetter`
 *     here: the caller recomputes it from the current zoom and viewport size.
 *   - `imageHandlers` (`onPointerDown` / `onPointerMove` / …) become
 *     named `onImage*` handlers a template binds as native `@pointerdown` and
 *     friends. A handler's `currentTarget` and a native listener's `currentTarget`
 *     are both the element the handler is attached to.
 */
import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from "vue";

type Point = { x: number; y: number };
type Drag = { pointerId: number; element: HTMLImageElement; start: Point; origin: Point; moved: boolean };

/** Own pointer capture and keep a recoverable part of the image in view. */
export function useImagePreviewPan(
  id: MaybeRefOrGetter<string>,
  src: MaybeRefOrGetter<string | undefined>,
  bounds: MaybeRefOrGetter<Point>,
) {
  const position = ref<Point>({ x: 0, y: 0 });
  const dragging = ref(false);
  let drag: Drag | null = null;
  let suppressClick = false;
  const clamp = (point: Point): Point => {
    const limit = toValue(bounds);
    return {
      x: Math.max(-limit.x, Math.min(limit.x, point.x)),
      y: Math.max(-limit.y, Math.min(limit.y, point.y)),
    };
  };
  const offset = computed(() => clamp(position.value));
  const release = () => {
    const current = drag;
    drag = null;
    if (current?.element.hasPointerCapture(current.pointerId)) {
      current.element.releasePointerCapture(current.pointerId);
    }
  };
  const reset = () => {
    release();
    suppressClick = false;
    dragging.value = false;
    position.value = { x: 0, y: 0 };
  };
  watch(
    [() => toValue(id), () => toValue(src)],
    () => {
      reset();
    },
    { flush: "post", immediate: true },
  );
  onScopeDispose(release);

  const end = (event: PointerEvent, cancelled = false) => {
    if (drag?.pointerId !== event.pointerId) return;
    suppressClick = !cancelled && drag.moved;
    release();
    dragging.value = false;
  };
  return {
    get offset() {
      return offset.value;
    },
    reset,
    get dragging() {
      return dragging.value;
    },
    moveBy: (x: number, y: number) => {
      position.value = clamp({ x: offset.value.x + x, y: offset.value.y + y });
    },
    onPointerDownCapture: () => {
      suppressClick = false;
    },
    onClickCapture: (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onImagePointerDown: (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || drag) return;
      event.preventDefault();
      const element = event.currentTarget as HTMLImageElement;
      element.setPointerCapture(event.pointerId);
      drag = {
        pointerId: event.pointerId,
        element,
        start: { x: event.clientX, y: event.clientY },
        origin: offset.value,
        moved: false,
      };
      dragging.value = true;
    },
    onImagePointerMove: (event: PointerEvent) => {
      const current = drag;
      if (!current || current.pointerId !== event.pointerId) return;
      const x = event.clientX - current.start.x;
      const y = event.clientY - current.start.y;
      current.moved ||= Math.hypot(x, y) > 3;
      if (current.moved) {
        position.value = clamp({ x: current.origin.x + x, y: current.origin.y + y });
      }
    },
    onImagePointerUp: (event: PointerEvent) => end(event),
    onImagePointerCancel: (event: PointerEvent) => end(event, true),
    onImageLostPointerCapture: (event: PointerEvent) => end(event, true),
  };
}
