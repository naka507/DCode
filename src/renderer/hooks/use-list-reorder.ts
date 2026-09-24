/**
 * Drag-to-reorder for a filtered list of rows.
 *
 * Dragging previews a destination; only dropping, or an arrow key on the handle,
 * edits the draft.
 *
 * The row binds named handlers rather than spreading an object of
 * them onto the row. Each handler takes the row's id as its first argument and
 * the event as its second. `visibleItems` and `busy` are read through `toValue`
 * because a Vue composable runs once and has to keep reading the current value.
 */
import {
  computed,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";
import {
  dropPlacement,
  sameDropTarget,
  visibleNeighborMove,
  type DropTarget,
  type ReorderPlacement,
} from "../lib/list-reorder";

export type ListReorderController = {
  draggingId: Ref<string | null>;
  dropTarget: Ref<DropTarget | null>;
  /** True while the list is busy or has nothing to reorder. */
  disabled: ComputedRef<boolean>;
  onRowDragEnter: (id: string, event: DragEvent) => void;
  onRowDragOver: (id: string, event: DragEvent) => void;
  onRowDragLeave: (id: string, event: DragEvent) => void;
  onRowDrop: (id: string, event: DragEvent) => void;
  onHandleDragStart: (id: string, event: DragEvent) => void;
  onHandleDragEnd: () => void;
  onHandleKeydown: (id: string, event: KeyboardEvent) => void;
};

export function useListReorder<T extends { id: string }>(
  visibleItems: MaybeRefOrGetter<readonly T[]>,
  move: (sourceId: string, targetId: string, placement: ReorderPlacement) => void,
  busy: MaybeRefOrGetter<boolean>,
  mimeType: string,
): ListReorderController {
  const draggingId = ref<string | null>(null);
  const dropTarget = ref<DropTarget | null>(null);
  const items = computed(() => toValue(visibleItems));
  const disabled = computed(() => toValue(busy) || items.value.length < 2);

  const clearDrag = () => {
    draggingId.value = null;
    dropTarget.value = null;
  };

  /*
    A drag whose source left the visible set (a filter changed under it, or the
    list went busy) is no longer a move the user can see: drop it. The
    effect lists `disabled, draggingId, visibleItems`.
  */
  watch([disabled, draggingId, items], () => {
    if (disabled.value || !items.value.some((item) => item.id === draggingId.value)) {
      draggingId.value = null;
      dropTarget.value = null;
    }
  });

  const destination = (id: string, clientY: number, element: HTMLElement): DropTarget => {
    const rect = element.getBoundingClientRect();
    return { id, placement: dropPlacement(clientY, rect.top, rect.height) };
  };

  /** Skip a preview write when the pointer stays inside the same half-row. */
  const previewDrop = (id: string, clientY: number, element: HTMLElement) => {
    const next = id === draggingId.value ? null : destination(id, clientY, element);
    if (sameDropTarget(dropTarget.value, next)) return;
    dropTarget.value = next;
  };

  const onRowDragEnter = (id: string, event: DragEvent) => {
    if (disabled.value || !draggingId.value) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onRowDragOver = (id: string, event: DragEvent) => {
    if (disabled.value || !draggingId.value) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    previewDrop(id, event.clientY, event.currentTarget as HTMLElement);
  };

  const onRowDragLeave = (id: string, event: DragEvent) => {
    const row = event.currentTarget as HTMLElement;
    if (row.contains(event.relatedTarget as Node | null)) return;
    if (dropTarget.value?.id === id) dropTarget.value = null;
  };

  const onRowDrop = (id: string, event: DragEvent) => {
    // Recover the source from the payload when the drag state is already gone.
    const sourceId = draggingId.value || event.dataTransfer?.getData(mimeType) || "";
    if (disabled.value || !sourceId) return;
    event.preventDefault();
    event.stopPropagation();
    const target = destination(id, event.clientY, event.currentTarget as HTMLElement);
    move(sourceId, id, target.placement);
    clearDrag();
  };

  const onHandleDragStart = (id: string, event: DragEvent) => {
    if (disabled.value) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(mimeType, id);
    }
    draggingId.value = id;
    dropTarget.value = null;
  };

  const onHandleKeydown = (id: string, event: KeyboardEvent) => {
    if (disabled.value || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    event.stopPropagation();
    const neighbor = visibleNeighborMove(
      items.value,
      id,
      event.key === "ArrowDown" ? "down" : "up",
    );
    if (!neighbor) return;
    move(id, neighbor.targetId, neighbor.placement);
  };

  return {
    draggingId,
    dropTarget,
    disabled,
    onRowDragEnter,
    onRowDragOver,
    onRowDragLeave,
    onRowDrop,
    onHandleDragStart,
    onHandleDragEnd: clearDrag,
    onHandleKeydown,
  };
}
