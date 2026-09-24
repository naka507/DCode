/**
 * Load a contained image ref into a bounded data URL.
 *
 * The `use-referenced-image-data-url` composable, the one
 * framework-neutral module the transcript cluster needs. Host
 * containment (workspace, scratch, attachments) is the gate; failures resolve
 * to `null`.
 *
 * `useEffect(fn, [ref, mimeType, workspaceRoot])` becomes a `watch` on the same
 * three values with `onCleanup` retiring the in-flight request.
 */
import { onScopeDispose, ref, watch, type Ref } from "vue";
import { api } from "./api";
import { useAppStore } from "../stores/app-store";

/**
 * Module-level cache so revisiting the same message does not re-read the
 * file. The key includes the workspace root so a relative path in one
 * project cannot show another project's file.
 */
const dataUrlCache = new Map<string, string>();
const DATA_URL_CACHE_ENTRIES = 50;
const DATA_URL_CACHE_MAX_BYTES = 40 * 1024 * 1024;
let dataUrlCacheBytes = 0;

function cacheKey(workspaceRoot: string | null, ref: string): string {
  return `${workspaceRoot ?? ""}\u0000${ref}`;
}

function rememberDataUrl(key: string, dataUrl: string) {
  const existing = dataUrlCache.get(key);
  if (existing !== undefined) {
    dataUrlCacheBytes -= existing.length;
    dataUrlCache.delete(key);
  }
  dataUrlCacheBytes += dataUrl.length;
  dataUrlCache.set(key, dataUrl);
  while (
    dataUrlCache.size > DATA_URL_CACHE_ENTRIES ||
    dataUrlCacheBytes > DATA_URL_CACHE_MAX_BYTES
  ) {
    const oldest = dataUrlCache.keys().next().value;
    if (oldest === undefined) break;
    const value = dataUrlCache.get(oldest);
    if (value !== undefined) dataUrlCacheBytes -= value.length;
    dataUrlCache.delete(oldest);
  }
}

export function useReferencedImageDataUrl(
  source: Ref<string | null | undefined> | (() => string | null | undefined),
  mimeType?: Ref<string | undefined> | (() => string | undefined),
): Ref<string | null> {
  const store = useAppStore();
  const dataUrl = ref<string | null>(null);
  let current = true;
  onScopeDispose(() => {
    current = false;
  });
  watch(
    () => {
      const raw = typeof source === "function" ? source() : source.value;
      const mime = typeof mimeType === "function" ? mimeType() : mimeType?.value;
      return [raw, mime, store.appState?.workspace?.path ?? null] as const;
    },
    ([raw, mime, workspaceRoot], _previous, onCleanup) => {
      const key = typeof raw === "string" ? raw.trim() : "";
      if (
        !key ||
        /^https?:/i.test(key) ||
        /^data:/i.test(key) ||
        /^blob:/i.test(key)
      ) {
        dataUrl.value = null;
        return;
      }
      const cacheKeyForRef = cacheKey(workspaceRoot, key);
      const cached = dataUrlCache.get(cacheKeyForRef);
      if (cached !== undefined) {
        dataUrl.value = cached;
        return;
      }
      let active = true;
      dataUrl.value = null;
      onCleanup(() => {
        active = false;
      });
      void api
        .fsReadImageDataUrl(key, mime)
        .then((result) => {
          const next =
            result.kind === "image" && result.dataUrl ? result.dataUrl : null;
          if (next) rememberDataUrl(cacheKeyForRef, next);
          if (active && current) dataUrl.value = next;
        })
        .catch(() => {
          if (active && current) dataUrl.value = null;
        });
    },
    { immediate: true },
  );
  return dataUrl;
}
