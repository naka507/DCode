/**
 * The framework-free half of the plugins presentation module.
 *
 * The pure derivations live here; the seven presentational components live next
 * door as one `.vue` each (`SearchField.vue`, `PermissionChips.vue`,
 * `FsScopeChips.vue`, `CapabilityChips.vue`, `ServiceChips.vue`,
 * `AgentExtensionDetails.vue`, `PluginRowDetails.vue`). What is left here is
 * the part that is just data:
 *
 *   2. The flat name list of a plugin's ExtensionAPI modules;
 *   3. which diagnostic kinds count as failures.
 *
 * Each is a plain function of its inputs, so it is unit-testable without a
 * renderer and is shared by the components that need it.
 */
import type {
  PluginAgentExtensionStatus,
  PluginFsPolicy,
  TrustedExtensionDiagnosticKind,
} from "@dcode/shared";
import { FS_MODES, permissionRisk } from "./model";

/** A translated label lookup, as `useI18n().t` provides it. */
export type Translate = (
  key: string,
  params?: Record<string, unknown>,
) => string;

/** One rendered file-scope chip: which mode, and the sentence describing it. */
export type FsScopeChip = {
  mode: (typeof FS_MODES)[number];
  text: string;
};

/**
 * `manifest.fs` read back to the user. A permission says the plugin may touch
 * files; this says which ones, and it is the only place that distinction is
 * visible outside the manifest.
 */
export function fsScopeChips(
  policy: PluginFsPolicy | undefined,
  t: Translate,
): FsScopeChip[] {
  return FS_MODES.flatMap((mode) => {
    const rule = policy?.[mode];
    if (!rule) return [];
    const parts: string[] = [];
    if (rule.root === "userSelected") parts.push(t("plugins.fsRootPicked"));
    if (rule.scope?.length) parts.push(rule.scope.join(" · "));
    if (rule.own) parts.push(t("plugins.fsOwnFiles"));
    // No standing reach at all: every access stops at a confirmation.
    if (!parts.length) parts.push(t("plugins.fsAsksEachTime"));
    return [{ mode, text: `${t(`plugins.fsMode.${mode}`)} · ${parts.join(" · ")}` }];
  });
}

/** The risk tier a file mode's chip is coloured by. */
export function fsModeRisk(mode: (typeof FS_MODES)[number]): string {
  return permissionRisk(`fs.${mode}`);
}

/** Tool names, `/`-prefixed command names and agent names, in one flat list. */
export function agentExtensionNames(status: PluginAgentExtensionStatus): string[] {
  return [
    ...status.toolNames,
    ...status.commandNames.map((name) => `/${name}`),
    ...status.agentNames,
  ];
}

/** The diagnostic kinds that mean the extension is broken, not just talking. */
export function isErrorDiagnostic(kind: TrustedExtensionDiagnosticKind): boolean {
  return (
    kind === "load_error" ||
    kind === "factory_error" ||
    kind === "handler_error" ||
    kind === "handler_timeout"
  );
}
