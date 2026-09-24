/**
 * Project folder arithmetic — pure, no renderer imports.
 *
 * Extracted from `ProjectCreateDialog` (path helpers) and the
 * project slice's `createNamedProjectGroup` (ordering), so the dialog, the
 * store, and the tests all share one definition.
 *
 * Every comparison goes through `normalizeProjectPath`, so `C:\repo`,
 * `C:/repo`, and `C:/repo/` are one folder on Windows and `…/repo/` is one
 * folder on POSIX. Deduping by raw string would let the same directory into the
 * list twice and create a group with a duplicate root.
 */
import { normalizeProjectPath } from "./sidebar-preferences";

/** Path segments, splitting on either separator and dropping empties. */
export function pathParts(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean);
}

/** Last segment of a path — the folder's own name. */
export function folderName(path: string): string {
  return pathParts(path).at(-1) ?? path;
}

/**
 * `…/parent` for a nested path, or the path itself at the root.
 *
 * The leading ellipsis is deliberate: the row shows a hint of where the folder
 * lives, not a full path (the full path is the row's `title`).
 */
export function folderParent(path: string): string {
  const parts = pathParts(path);
  return parts.length > 1 ? `…/${parts.slice(-2, -1)[0]}` : path;
}

/** Do two picks name the same directory? Separators and trailing slash ignored. */
export function sameProjectPath(left: string, right: string): boolean {
  return normalizeProjectPath(left) === normalizeProjectPath(right);
}

/**
 * Fold one folder pick and one git checkout onto the same project semantic: a
 * de-duplicated folder list whose primary root leads.
 *
 * The primary is resolved against the surviving folders, so a primary the user
 * removed from the list falls back to the first folder still there rather than
 * disappearing from the group.
 */
export function orderProjectFolders(
  folders: string[],
  primaryPath?: string,
): { orderedFolders: string[]; primary: string | null } {
  const uniqueFolders = folders.filter(
    (path, index, all) =>
      Boolean(normalizeProjectPath(path)) &&
      all.findIndex((candidate) => sameProjectPath(candidate, path)) === index,
  );
  if (uniqueFolders.length === 0) return { orderedFolders: [], primary: null };
  const normalizedPrimary = normalizeProjectPath(primaryPath ?? uniqueFolders[0]);
  const primary =
    uniqueFolders.find((path) => normalizeProjectPath(path) === normalizedPrimary) ??
    uniqueFolders[0];
  return {
    orderedFolders: [
      primary,
      ...uniqueFolders.filter((path) => !sameProjectPath(path, primary)),
    ],
    primary,
  };
}

/** Append picks to a folder list, skipping directories already in it. */
export function appendProjectFolders(current: string[], picked: string[]): string[] {
  return [
    ...current,
    ...picked.filter((path) => !current.some((existing) => sameProjectPath(existing, path))),
  ];
}
