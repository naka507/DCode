import { latestSessionOutcomes } from "@dcode/shared";

/**
 * The unread-outcome algebra lives in `src/shared` so the tray menu and the
 * sidebar badge cannot disagree about which session has an unread result. This
 * module owns the sidebar's status vocabulary and re-exports the shared half.
 */
export { latestSessionOutcomes };

export type SidebarSessionStatus =
  | "running"
  | "selected"
  | "completed"
  | "failed"
  | "permission";
export type SidebarSessionOutcome = Extract<
  SidebarSessionStatus,
  "completed" | "failed"
>;

export function sidebarSessionStatus({
  running,
  selected,
  outcome,
  hasPendingPermission,
}: {
  running: boolean;
  selected: boolean;
  outcome?: "completed" | "failed";
  hasPendingPermission?: boolean;
}): SidebarSessionStatus | null {
  if (hasPendingPermission) return "permission";
  if (running) return "running";
  if (selected) return "selected";
  return outcome ?? null;
}
