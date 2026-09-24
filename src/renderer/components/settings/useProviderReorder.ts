/**
 * Provider row reordering for the model-config page.
 *
 * The move is
 * optimistic: the released destination paints immediately and the host write
 * follows, so the row never springs back while the RPC is in flight. On failure
 * the accepted list is restored and the reason is toasted.
 *
 * The write is guarded by `onScopeDispose`, so a late failure cannot
 * set state after the composable's scope is gone — the same lifetime the
 * unmount guard would express.
 */
import { computed, onScopeDispose, ref, toValue, type MaybeRefOrGetter } from "vue";
import { useI18n } from "vue-i18n";
import type { ProviderPublic } from "@dcode/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { useCardReorder } from "../../hooks/use-card-reorder";
import { reorderItem, type ReorderPlacement } from "../../lib/list-reorder";

/** Preview a released move while saving; restore the accepted list on failure. */
export function useProviderReorder(
  providers: MaybeRefOrGetter<ProviderPublic[]>,
  busy: MaybeRefOrGetter<boolean>,
) {
  const { t } = useI18n();
  const store = useAppStore();
  const saving = ref(false);
  const draft = ref<ProviderPublic[] | null>(null);
  let pending = false;
  let mounted = true;

  onScopeDispose(() => {
    mounted = false;
  });

  const move = async (id: string, targetId: string, placement: ReorderPlacement) => {
    const current = toValue(providers);
    if (pending || toValue(busy)) return;
    const next = reorderItem(current, id, targetId, placement);
    if (next === current) return;
    pending = true;
    saving.value = true;
    draft.value = next;
    try {
      await api.reorderProviders({ id, targetId, placement });
      await store.appState?.refreshProviders();
    } catch (error) {
      store.appState?.showToast(
        t("settings.providerOrderFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
        { variant: "error" },
      );
    } finally {
      pending = false;
      if (mounted) {
        saving.value = false;
        draft.value = null;
      }
    }
  };

  const reorder = useCardReorder(
    computed(() => draft.value ?? toValue(providers)),
    () => toValue(busy) || saving.value,
    (id, target, placement) => {
      void move(id, target, placement);
    },
  );

  return {
    ...reorder,
    saving,
    providers: computed(() => draft.value ?? toValue(providers)),
  };
}
