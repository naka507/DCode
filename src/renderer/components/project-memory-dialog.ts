/**
 * Framework-free half of the project memory dialog.
 *
 * The four pure entry helpers of the project memory dialog, kept apart from
 * the presentational dialog. The dialog itself is
 * `components/ProjectMemoryDialog.vue`; nothing here touches Vue.
 */
import type { ProjectMemory, ProjectMemoryEntry } from "@dcode/shared";

export function newEntry(): ProjectMemoryEntry {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    "memory-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  return { id, title: "", content: "" };
}

export function entriesFromMemory(memory: ProjectMemory): ProjectMemoryEntry[] {
  if (memory.entries) return memory.entries;
  return memory.content.trim()
    ? [{ id: "legacy-project-memory", title: "", content: memory.content.trim() }]
    : [];
}

export function normalizeEntries(entries: ProjectMemoryEntry[]): ProjectMemoryEntry[] {
  return entries
    .map((entry) => ({
      id: entry.id.trim(),
      title: entry.title.trim(),
      content: entry.content.trim(),
    }))
    .filter((entry) => entry.content.length > 0);
}

export function entriesEqual(left: ProjectMemoryEntry[], right: ProjectMemoryEntry[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}
