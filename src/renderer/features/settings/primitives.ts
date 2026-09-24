/**
 * Pure helpers behind the settings row primitives.
 *
 * The presentational components live next door in
 * `features/settings/primitives/*.vue`; what is left here is the part that is
 * just data: which command shell a row shows as selected, what the effective
 * status line says, and the option tuples the two segmented rows iterate.
 */
import type { AppSettings, CommandShellCatalog } from "@dcode/shared";

/**
 * The shell the select shows: an in-flight user choice wins over the host's
 * configured id, then its effective id, then the persisted setting.
 */
export function selectedCommandShellId(
  catalog: CommandShellCatalog | null,
  settings: AppSettings,
  selectedOverride: string | null,
): string {
  return (
    selectedOverride ??
    catalog?.configuredId ??
    catalog?.effective?.id ??
    settings.defaultCommandShell ??
    ""
  );
}

/**
 * The line under the shell select: why the effective shell differs from the
 * configured one, or null when there is nothing worth saying.
 */
export function commandShellEffectiveStatus(
  catalog: CommandShellCatalog | null,
  t: (key: string, params?: Record<string, unknown>) => string,
): string | null {
  const effectiveChoice = catalog?.effective;
  if (catalog && !effectiveChoice && catalog.choices.length > 0) {
    return t("settings.commandShellNoEffective");
  }
  if (!catalog || !effectiveChoice) return null;
  if (!catalog.configuredId) {
    return t("settings.commandShellDefault", { shell: effectiveChoice.label });
  }
  const configuredChoice = catalog.choices.find(
    (choice) => choice.id === catalog.configuredId,
  );
  if (
    catalog.fallback ||
    catalog.configuredId !== effectiveChoice.id ||
    configuredChoice?.available === false
  ) {
    return t("settings.commandShellFallback", { shell: effectiveChoice.label });
  }
  return null;
}

/** Where a clicked link opens; the two-segment row's options. */
export const LINK_OPEN_TARGET_OPTIONS = [
  ["workpanel", "settings.linkOpenTargetWorkpanel"],
  ["external", "settings.linkOpenTargetExternal"],
] as const;

/** Which figure the composer context ring leads with. */
export const CONTEXT_USAGE_DISPLAY_OPTIONS = [
  ["remaining", "settings.contextUsageDisplayRemaining"],
  ["used", "settings.contextUsageDisplayUsed"],
] as const;
