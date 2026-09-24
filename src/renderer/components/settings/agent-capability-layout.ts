/**
 * Framework-free half of `AgentCapabilityLayout.vue`.
 *
 * This module mixes plain helpers and composables with eleven
 * presentational components. A `.vue` file cannot export either to a sibling, so
 * the module is split along that seam:
 *
 *   - here: the project-option model, `projectDisplayName`, `useAgentProjects`
 *     and `matchesCapabilitySearch`, plus the two types the pages share;
 *   - `AgentCapabilityLayout.vue`: `AgentProjectPicker`, `CapabilityToggle`,
 *     `AgentCapabilityPage`, `CapabilityToolbar`, `CapabilityPanel`,
 *     `CapabilityGroupHeader`, `CapabilityRow`, `CapabilityRowMenu`,
 *     `CapabilitySkeleton`, `CapabilityEmpty`, `CapabilityButton`.
 *
 * `useArmedDelete` is not re-exported from here. It once was, so the
 * three pages could reach it through the layout they already imported; in this
 * tree the hook lives at `hooks/use-armed-delete.ts` and the pages import it from
 * there directly.
 *
 * The `.ts` and the `.vue` deliberately do not share a base name, so a reader
 * cannot mistake this file for the component (the "split module hides a missing
 * component" trap recorded in docs/ARCHITECTURE.md).
 */
import { computed, onMounted, onUnmounted, ref, watch, type Component } from "vue";
import type { ProjectRecord } from "@dcode/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";

export type AgentProjectOption = {
  name: string;
  path: string;
};

/** Which level the workbench is currently showing. */
export type CapabilityFilter = "all" | "global" | "project";

export function projectDisplayName(path: string, fallback?: string): string {
  if (fallback?.trim()) return fallback.trim();
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) || path;
}

/**
 * Recent projects plus the project currently open in the window.
 *
 * Vue form of the projects hook. The store read becomes a `computed` over
 * `store.appState` (the payload is a `shallowRef`, so a plain read is tracked);
 * the three `useEffect`s become a mount fetch plus two `watch`es. The selection
 * effect is a watcher on both `options` and the selection, exactly as the
 * dependency array had it.
 */
export function useAgentProjects() {
  const store = useAppStore();
  const currentProjectPath = computed(
    () => store.appState?.workspace?.path ?? null,
  );
  const projects = ref<ProjectRecord[]>([]);
  const selectedProjectPath = ref<string | null>(currentProjectPath.value);

  let cancelled = false;
  onMounted(() => {
    void api
      .listProjects()
      .then((result) => {
        if (cancelled) return;
        projects.value = result.projects ?? [];
      })
      .catch(() => {
        if (!cancelled) projects.value = [];
      });
  });
  onUnmounted(() => {
    cancelled = true;
  });

  watch(currentProjectPath, (path) => {
    if (path) selectedProjectPath.value = path;
  });

  const options = computed<AgentProjectOption[]>(() => {
    const seen = new Set<string>();
    const result: AgentProjectOption[] = [];
    const add = (path: string | null | undefined, name?: string) => {
      const normalized = path?.trim();
      if (!normalized) return;
      const key = normalized.toLocaleLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push({ path: normalized, name: projectDisplayName(normalized, name) });
    };
    add(currentProjectPath.value);
    for (const project of projects.value) add(project.path, project.name);
    return result;
  });

  watch([options, selectedProjectPath], () => {
    const list = options.value;
    if (list.length === 0) {
      if (selectedProjectPath.value) selectedProjectPath.value = null;
      return;
    }
    if (
      !selectedProjectPath.value ||
      !list.some((project) => project.path === selectedProjectPath.value)
    ) {
      selectedProjectPath.value = list[0]!.path;
    }
  });

  return {
    currentProjectPath,
    selectedProjectPath,
    setSelectedProjectPath: (path: string | null) => {
      selectedProjectPath.value = path;
    },
    projects,
    options,
  };
}

/** Case-insensitive substring match across whichever fields a row exposes. */
export function matchesCapabilitySearch(
  query: string,
  ...fields: readonly (string | undefined | null)[]
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return fields.some((field) => field?.toLocaleLowerCase().includes(needle));
}

/**
 * One entry of a row's overflow menu.
 *
 * The `icon` is a rendered node (`<IconTrash size={14} />`). Every call
 * site in the three pages uses the same 14px box, so the Vue form carries the
 * component and `CapabilityRowMenu` renders it at that size.
 */
export type CapabilityMenuItem = {
  key: string;
  label: string;
  icon?: Component;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};
