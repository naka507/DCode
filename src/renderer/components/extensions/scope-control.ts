/**
 * Framework-free half of the extension scope control.
 *
 * The presentational control itself is `components/extensions/ScopeControl.vue`,
 * and that file re-exports every name below from its plain `<script>` block, so
 * `projectLabel`, `ScopeTarget` and `ScopeControlProps` stay reachable at one
 * specifier.
 *
 * `ScopeControlProps` differs from the component in one place: the two
 * callbacks (`onSetEnabled`, `onSetScope`) are the `.vue`'s `set-enabled` and
 * `set-scope` emits, so they are not part of this props shape. See the
 * component's header note.
 */
import { normalizeProjectPath, type ActivationScope, type ProjectRecord } from "@dcode/shared";

export type ScopeTarget = {
  enabled: boolean;
  scope?: ActivationScope;
};

export type ScopeControlProps = {
  target: ScopeTarget;
 /** Accessible name of the thing being scoped, e.g. The plugin's name. */
  label: string;
  /** The project open in this window, offered first by the This project choice. */
  currentProjectPath?: string | null;
  /** Everything the picker can offer, newest-first as the sidebar orders them. */
  projects: readonly ProjectRecord[];
  disabled?: boolean;
  /** Renders one current-state trigger with a menu, for dense rows. */
  compact?: boolean;
};

/** The three choices, in the order the control renders them. */
export const STATE_ORDER = ["off", "projects", "global"] as const;

export const STATE_LABEL_KEYS: Record<(typeof STATE_ORDER)[number], string> = {
  off: "extensions.scope.off",
  projects: "extensions.scope.projects",
  global: "extensions.scope.global",
};

export const STATE_HINT_KEYS: Record<(typeof STATE_ORDER)[number], string> = {
  off: "extensions.scope.offHint",
  projects: "extensions.scope.projectsHint",
  global: "extensions.scope.globalHint",
};

/** Trailing path segment, which is what the user recognizes a project by. */
export function projectLabel(path: string): string {
  const normalized = normalizeProjectPath(path);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized || path;
}
