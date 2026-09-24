/**
 * Retain only browsing choices across route unmounts, never dialogs or work.
 *
 * Module-scope refs give the same lifetime — the state outlives the page
 * component and is shared by every consumer — while staying tracked when a
 * component reads them.
 */
import { ref } from "vue";

const installedQuery = ref("");

export function usePluginBrowseState() {
  return {
    installedQuery,
    setInstalledQuery: (next: string) => {
      installedQuery.value = next;
    },
  };
}
