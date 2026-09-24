import type { ModelBinding } from "@dcode/shared";
import type { MaybeRefOrGetter } from "vue";
import { useListReorder } from "../../hooks/use-list-reorder";
import { reorderItem } from "../../lib/list-reorder";

/** The chosen-model list's own drag payload; a drop recovers the source from it. */
export const MODEL_REORDER_MIME = "application/x-dcode-model";

export function useModelReorder(
  visibleModels: MaybeRefOrGetter<readonly ModelBinding[]>,
  setModels: (update: (current: ModelBinding[]) => ModelBinding[]) => void,
  busy: MaybeRefOrGetter<boolean>,
) {
  return useListReorder(
    visibleModels,
    (source, target, placement) => {
      setModels((current) => reorderItem(current, source, target, placement));
    },
    busy,
    MODEL_REORDER_MIME,
  );
}
