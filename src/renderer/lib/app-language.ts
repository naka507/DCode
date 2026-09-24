/**
 * Language synchronisation for the Vue renderer.
 *
 * The OS locale reported by the preload bridge is authoritative for "auto", and
 * the persisted `settings.language` is applied to both the i18n instance and the
 * document element as soon as it changes.
 */
import { isAppLocale, resolveLocale, type AppLocale } from "@dcode/i18n";
import type { AppSettings } from "@dcode/shared";
import { i18n } from "../i18n";

export type AppLanguageSetting = NonNullable<AppSettings["language"]>;

/**
 * Authoritative OS locale for "auto" detection.
 *
 * `navigator.language` often reports `en-US` regardless of the actual system
 * language, so the main process's `app.getLocale()` (exposed synchronously by
 * the preload bridge) wins when present.
 */
export function resolveOsLocale(): string {
  return (
    window.dcode?.locale ||
    navigator.language ||
    (navigator as { userLanguage?: string }).userLanguage ||
    "en-US"
  );
}

/** Concrete locale for a stored language setting; `auto`/absent follows the OS. */
export function resolveAppLanguage(language: AppSettings["language"]): AppLocale {
  if (language && language !== "auto" && isAppLocale(language)) return language;
  return resolveLocale(resolveOsLocale());
}

export function applyAppLanguage(language: AppSettings["language"]): void {
  const target = resolveAppLanguage(language);
  document.documentElement.lang = target;
  if (i18n.global.locale.value !== target) i18n.global.locale.value = target;
}
