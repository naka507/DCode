/**
 * Framework-free half of the Developer settings sections.
 *
 * Split out of the developer-sections component, which mixed this one option table with
 * the two presentational sections. The components themselves live next door in
 * `features/settings/DeveloperSection.vue` and
 * `features/settings/CloseBehaviorSection.vue`.
 */
import type { CloseBehavior } from "@dcode/shared";

/**
 * The two remembered close behaviors, with their label keys.
 *
 * The "ask" state (unset) is transient and cannot be re-selected: once a choice
 * is made it is remembered permanently, so an unset preference shows no active
 * option and this table deliberately omits it.
 */
export const CLOSE_BEHAVIOR_OPTIONS = [
  ["tray", "settings.closeBehaviorTray"],
  ["quit", "settings.closeBehaviorQuit"],
] as const satisfies readonly (readonly [CloseBehavior, string])[];
