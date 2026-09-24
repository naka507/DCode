<script lang="ts">
/**
 * The agent-capability layout module.
 *
 * This module was one file exporting eleven
 * components plus four helpers. A `.vue` file cannot *declare* a second
 * component, so each component lives in its own SFC next door and this file is
 * the module's import surface: it re-exports every original name, so the three
 * pages keep importing them from `./AgentCapabilityLayout.vue` exactly as
 * they always did.
 *
 * The framework-free half is in `./agent-capability-layout` (project options,
 * `projectDisplayName`, `useAgentProjects`, `matchesCapabilitySearch` and the
 * shared types). That `.ts` deliberately does not share this file's base name,
 * so the "a leftover `.ts` sharing a name with an uncreated `.vue` hides a
 * missing component" trap cannot apply here.
 *
 * `useArmedDelete` is re-exported from here because this module
 * always did; its implementation is `hooks/use-armed-delete.ts`, shared with the
 * session and project rows.
 *
 * The default export is this module's own component — `AgentCapabilityPage`,
 * the page shell — so a route can render the module itself if it ever needs to.
 */
import AgentCapabilityPage from "./AgentCapabilityPage.vue";

export { default as AgentCapabilityPage } from "./AgentCapabilityPage.vue";
export { default as AgentProjectPicker } from "./AgentProjectPicker.vue";
export { default as CapabilityButton } from "./CapabilityButton.vue";
export { default as CapabilityEmpty } from "./CapabilityEmpty.vue";
export { default as CapabilityGroupHeader } from "./CapabilityGroupHeader.vue";
export { default as CapabilityPanel } from "./CapabilityPanel.vue";
export { default as CapabilityRow } from "./CapabilityRow.vue";
export { default as CapabilityRowMenu } from "./CapabilityRowMenu.vue";
export { default as CapabilitySkeleton } from "./CapabilitySkeleton.vue";
export { default as CapabilityToggle } from "./CapabilityToggle.vue";
export { default as CapabilityToolbar } from "./CapabilityToolbar.vue";

export {
  matchesCapabilitySearch,
  projectDisplayName,
  useAgentProjects,
  type AgentProjectOption,
  type CapabilityFilter,
  type CapabilityMenuItem,
} from "./agent-capability-layout";
export { useArmedDelete } from "../../hooks/use-armed-delete";

export default AgentCapabilityPage;
</script>
