/**
 * The active theme, read from `documentElement[data-theme]`.
 *
 * Read through a `MutationObserver` that mirrors the attribute into a `ref`,
 * which for a DOM attribute is the tracked-value equivalent of a store
 * subscription: the read is a plain value instead of a snapshot function.
 *
 * The observer is module-scoped and shared: one observer is registered for the
 * first subscriber and kept for the module's lifetime, because code blocks mount
 * and unmount constantly while streaming.
 */
import { onScopeDispose, readonly, ref, type DeepReadonly, type Ref } from "vue";
import type { ThemeMode } from "./shiki";

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function snapshot(): ThemeMode {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribe(listener: () => void): () => void {
  if (!observer) {
    observer = new MutationObserver(() => {
      for (const notify of listeners) notify();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThemeMode(): DeepReadonly<Ref<ThemeMode>> {
  const mode = ref(snapshot());
  const unsubscribe = subscribe(() => {
    mode.value = snapshot();
  });
  onScopeDispose(unsubscribe);
  return readonly(mode);
}
