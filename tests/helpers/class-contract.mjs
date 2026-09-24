/**
 * Class-name contract parsing, shared by `tests/vue-class-contract.test.mjs`.
 *
 * The renderer's visual system is the shared stylesheet under
 * `src/renderer/styles/` — partials of semantic class names sequenced by
 * `globals.css`, with Tailwind contributing only the `@theme` token scales.
 * Components are expected to carry the class names the stylesheet defines,
 * so the existing rules keep styling them.
 *
 * The failure this guards against is drift: a `.vue` file that invents its own
 * class names (and usually a private `<style>` block with it) renders an
 * unstyled surface while the stylesheet it was supposed to use sits unused.
 * `PluginLauncher.vue` did exactly that — `.dc-launcher*`
 * matched no rule anywhere.
 *
 * Both directions are heuristics over source text, so they are deliberately
 * biased to the forms this codebase actually uses and unit-tested against the
 * adversarial fixtures in the test file.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const rendererRoot = fileURLToPath(new URL("../../src/renderer/", import.meta.url));

/**
 * Documented exceptions, keyed by renderer-relative path.
 *
 * `classes` is exhaustive: an allowlisted file may not grow a new undefined
 * class name without failing the contract test, so the list cannot be used as a
 * blanket opt-out.
 */
export const CLASS_ALLOWLIST = {
  "App.vue": {
    reason:
      "Phase-1 boot shell that reports host health before any feature surface exists; no design-system CSS covers it, and the chat shell port replaces it.",
    classes: [
      "dc-boot",
      "dc-boot__bad",
      "dc-boot__error",
      "dc-boot__grid",
      "dc-boot__subtitle",
      "dc-boot__title",
    ],
  },
  "components/ProjectCreateDialog.vue": {
    reason:
      "Class names carried over verbatim from the reference markup that no stylesheet in this tree ever styled; dropping them would diverge from the rendered DOM for no visual change.",
    classes: [
      "project-create-dialog-clone",
      "project-create-dialog-field-label",
      "project-create-dialog-folders",
      "project-create-dialog-identity",
      "project-create-dialog-name-head",
      "project-create-dialog-source-section",
    ],
  },
  "components/ExtensionPromptDialog.vue": {
    reason:
      "Overlay/dialog modifier classes the markup carried and the stylesheet never defined; the dialog reuses the session-rename surface.",
    classes: ["extension-prompt-dialog", "extension-prompt-overlay"],
  },
  "components/StartupSplash.vue": {
    reason:
      "`sr-only` is a Tailwind accessibility utility the markup used for the screen-reader-only status text; the stylesheet never defines it.",
    classes: ["sr-only"],
  },
  "components/UpdateBanner.vue": {
    reason:
      "Tailwind `size-*` utilities carried over verbatim from the markup, which the stylesheet never defined.",
    classes: ["size-3.5", "size-4"],
  },
  "components/ui/Button.vue": {
    reason:
      "The size=\"sm\" utility trio the `Button` component appended to `btn`; the stylesheet defines `btn` and its variants but never these Tailwind utilities.",
    classes: ["px-2.5", "py-1", "text-xs"],
  },
  "components/ui/Field.vue": {
    reason:
      "Layout and type utilities carried over verbatim from the `Field` markup; the stylesheet never defined them for this surface. `text-xs` and `text-text-muted` left with the hint line when `b8daa88a` moved that sentence onto the label's help icon.",
    classes: [
      "block",
      "space-y-1.5",
      "text-sm",
      "text-text-secondary",
    ],
  },
  "features/app/chrome/ErrorBoundary.vue": {
    reason:
      "The crash fallback is the reference markup verbatim, rendered through Tailwind; no stylesheet in this tree covers this surface.",
    classes: [
      "bg-bg-primary",
      "bg-bg-secondary",
      "border",
      "border-border-default",
      "flex",
      "font-semibold",
      "h-full",
      "items-center",
      "justify-center",
      "max-w-lg",
      "mb-2",
      "p-5",
      "p-8",
      "rounded-lg-plus",
      "text-base-plus",
      "text-error",
      "text-sm-plus",
      "text-text-primary",
      "whitespace-pre-wrap",
    ],
  },
  "components/NotificationCenter.vue": {
    reason:
      "`sr-only` is the Tailwind accessibility utility the markup used for the screen-reader-only unread count; the stylesheet never defines it. Same exemption as `components/StartupSplash.vue`.",
    classes: ["sr-only"],
  },
  "components/ProjectEditDialog.vue": {
    reason:
      "Class names carried over verbatim from the reference markup that no stylesheet in this tree ever styled; `ProjectEditDialog` is the sibling of `ProjectCreateDialog` and shares its field markup, so it inherits that file's exemption. Verified: none of these names matches a rule prelude in `src/renderer/styles/*.css`.",
    classes: [
      "project-create-dialog-field-label",
      "project-create-dialog-folders",
      "project-create-dialog-identity",
      "project-create-dialog-name-head",
      "project-edit-dialog",
    ],
  },
  "components/settings/NetworkProxySection.vue": {
    reason:
      "`settings-command-shell-state` is the state-text modifier the markup carried and the stylesheet never defined; it is shared with the settings primitives below.",
    classes: ["settings-command-shell-state"],
  },
  "features/chat/transcript/MessageMeta.vue": {
    reason:
      "`throughput` is the chip's modifier class from the reference markup; the stylesheet styles `.message-meta-chip` but never the per-chip modifier.",
    classes: ["throughput"],
  },
  "features/sessions/SessionHoverCard.vue": {
    reason:
      "`sr-only` is the Tailwind accessibility utility the markup used for the screen-reader-only session status; the stylesheet never defines it.",
    classes: ["sr-only"],
  },
  "features/settings/primitives/CommandShellRow.vue": {
    reason:
      "The command-shell control/select/state/status modifiers the reference markup carried; the row is styled through Tailwind and no stylesheet in this tree defines these names.",
    classes: [
      "settings-command-shell-control",
      "settings-command-shell-select",
      "settings-command-shell-state",
      "settings-command-shell-status",
    ],
  },
  "features/settings/primitives/LargePasteThresholdRow.vue": {
    reason:
      "`settings-command-shell-state` is the state-text modifier shared with `CommandShellRow`; no stylesheet in this tree defines it.",
    classes: ["settings-command-shell-state"],
  },
  "components/Sidebar.vue": {
    reason:
      "Two groups, both carried over verbatim from the markup. `flex-1`, `min-h-0`, `overflow-auto`, `px-0.5` and `sr-only` are Tailwind utilities applied on the scrolling session-group container and the screen-reader-only project description; `project-more` and `thread-item-source` are surface modifiers the stylesheet never defined (verified against `src/renderer/styles/*.css`).",
    classes: [
      "flex-1",
      "min-h-0",
      "overflow-auto",
      "project-more",
      "px-0.5",
      "sr-only",
      "thread-item-source",
    ],
  },
  "components/OnboardingChecklist.vue": {
    reason:
      "The whole utility class list is carried over verbatim from the `OnboardingChecklist` markup, which is styled through Tailwind: `.home-onboarding-checklist` is the only rule the stylesheet defines for this surface (verified against `src/renderer/styles/*.css`, where `home-onboarding-checklist` is the sole match). Dropping the rest would diverge from the rendered DOM for no visual gain: this contract scans only the hand-written partials under `src/renderer/styles/`, while these utilities are generated by Tailwind at build time and are therefore styled in the running app — verified present in the built `out/renderer/assets/*.css` for all of them except `bg-bg-elevated-opaque`, which is inert in this tree because `@theme` defines `--color-bg-elevated`, not the `-opaque` variant (`tokens.css` holds `--ds-bg-elevated-opaque`, a different name). Same situation as the `sr-only` and `size-*` entries above.",
    classes: [
      "bg-bg-elevated-opaque",
      "bg-success/15",
      "border",
      "border-border-strong",
      "border-border-subtle",
      "border-success",
      "cursor-default",
      "flex",
      "flex-col",
      "flex-none",
      "font-medium",
      "gap-1.5",
      "gap-2.5",
      "h-4.5",
      "hover:bg-bg-hover",
      "hover:text-text-primary",
      "items-center",
      "justify-between",
      "justify-center",
      "line-through",
      "max-w-[560px]",
      "mb-2",
      "mx-auto",
      "p-4",
      "px-1.5",
      "px-2",
      "py-0.5",
      "py-1.5",
      "rounded-full",
      "rounded-lg-plus",
      "rounded-md",
      "shadow-none",
      "text-left",
      "text-md",
      "text-md-plus",
      "text-success",
      "text-text-muted",
      "text-text-primary",
      "text-text-secondary",
      "text-transparent",
      "text-xs-plus",
      "w-4.5",
      "w-full",
    ],
  },
  "features/chat/composer/ComposerStatus.vue": {
    reason:
      "Per-action and per-surface modifier classes carried over verbatim from the `ComposerStatus` markup; the stylesheet styles the shared `.composer-queued-prompt-action` / `.composer-directory-drop-*` classes but never these modifiers. Verified: none of them matches a rule prelude in `src/renderer/styles/*.css`.",
    classes: [
      "composer-directory-drop-dismiss",
      "composer-queued-prompt-edit",
      "composer-queued-prompt-move-down",
      "composer-queued-prompt-move-up",
      "composer-queued-prompt-remove",
    ],
  },
  "components/ConversationMinimap.vue": {
    reason:
      "`loading` is the state modifier the markup appended to the earlier-history dash (`minimap-marker history ${loadingEarlier ? \"loading\" : \"\"}`); the stylesheet never defined it (verified: no `.loading` rule prelude in this tree). The disabled/dimmed state it was meant to signal is carried by `:disabled` and `.minimap-marker.history:disabled::before` in `styles/chat-shell.css`.",
    classes: ["loading"],
  },
  "components/PlanApprovalBar.vue": {
    reason:
      "`sr-only` is the Tailwind accessibility utility the markup used for the screen-reader-only status announcement; the stylesheet never defines it. Same exemption as the `StartupSplash` / `NotificationCenter` / `Sidebar` entries above.",
    classes: ["sr-only"],
  },
  "components/AskToolCard.vue": {
    reason:
      "`asktool-custom-option` is the custom-answer row modifier the markup carried; the stylesheet defines the shared `.asktool-option` and `.asktool-option.selected` rules but never this modifier (verified: no rule prelude for it in this tree).",
    classes: ["asktool-custom-option"],
  },
  "components/HomeProjectSwitcher.vue": {
    reason:
      "`sr-only` is the Tailwind accessibility utility the markup used for the screen-reader-only clone-URL and search field labels; the stylesheet never defines it. Same exemption as the `StartupSplash` / `NotificationCenter` / `Sidebar` entries above.",
    classes: ["sr-only"],
  },
  "components/ReviewChangeCard.vue": {
    reason:
      "Four status modifier classes the markup carried: `is-rolled-back` verbatim and `is-added` / `is-modified` / `is-deleted` built by `cx(\"review-change-card-mark\", `is-${change.status}`)` at line 153. The stylesheet defines `.review-change-card-mark` and `.review-change-state` but never the per-status modifiers (verified: no rule prelude for any of the four in this tree). The Vue component spells the three dynamic ones as an object `:class` so the contract sees literal names instead of the glued fragment `is-`.",
    classes: ["is-added", "is-deleted", "is-modified", "is-rolled-back"],
  },
  "features/chat/composer/ComposerModelPicker.vue": {
    reason:
      "Three Tailwind utilities carried verbatim from the markup: `sr-only` on the search field's screen-reader label, `truncate` on the option title (line 199) and `flex-1` on the thinking-level row (line 246). No stylesheet in this tree defines any of the three (verified: no rule prelude in this tree), while Tailwind does emit all three into the built `out/renderer/assets/*.css`, so they are styled in the running app and only invisible to this hand-written-partials scan. Same situation as the `sr-only` / `flex-1` entries for `Sidebar.vue` and `StartupSplash.vue`.",
    classes: ["flex-1", "sr-only", "truncate"],
  },
  "features/chat/composer/ComposerToolbar.vue": {
    reason:
      "Three Tailwind utilities carried verbatim from the markup: `text-sm` on the mode-chip label and the permission chip (lines 158 and 199) and `flex-1 text-left` on the send button's label span (line 231). No stylesheet in this tree defines any of the three (verified: no rule prelude in this tree), while Tailwind emits all three into the built `out/renderer/assets/*.css`, so they are styled in the running app and only invisible to this hand-written-partials scan. Same situation as the `ComposerModelPicker.vue` entry above.",
    classes: ["flex-1", "text-left", "text-sm"],
  },

  "components/Composer.vue": {
    reason:
      "Two class names carried verbatim from the `Composer` markup that no stylesheet in this tree defines (verified: no rule prelude for either in `src/renderer/styles/*.css`). `composer-status` is the read-only banner (`className=\"composer-status\" role=\"status\"`), a Native-Pi-session-only row that never got a rule; `is-gated` is the state modifier appended to `composer-shell` for the same reason. Keeping both keeps the rendered DOM. Every other class this component renders (`composer-dock`, `composer-dock-home`, `composer-dock-docked`, `composer-stack`, `composer-shell`, `is-drop-target`) is defined by `styles/composer.css` and is deliberately not listed here.",
    classes: ["composer-status", "is-gated"],
  },

  "pages/PullRequestsPage.vue": {
    reason:
      "Fifteen Tailwind utilities carried verbatim from the `PullRequestsPage` markup (line 63 `flex gap-2`, line 103 `ml-1 text-text-muted`, line 115 `text-base-plus font-medium`, line 116 `mt-5`, line 127 `mt-2 max-w-md text-md text-text-secondary`, line 139 `text-sm font-normal text-text-muted`, line 142 `min-w-0 truncate`). No stylesheet in this tree defines any of them (verified: no rule prelude in this tree), while Tailwind emits all fifteen into the built `out/renderer/assets/*.css`, so they are styled in the running app and only invisible to this hand-written-partials scan. Same situation as the `ComposerModelPicker.vue` and `ComposerToolbar.vue` entries above. The page's semantic classes (`thread-scroll`, `page-frame`, `page-header`, `page-title`, `dest-*`, `page-card`, `page-empty*`, `icon-btn*`, `font-mono`, `btn`, `badge`) are all defined by `styles/destinations.css`, `styles/chat-shell.css`, `styles/ui-kit.css` and `styles/composer.css` and are deliberately not listed here.",
    classes: [
      "flex",
      "font-medium",
      "font-normal",
      "gap-2",
      "max-w-md",
      "min-w-0",
      "ml-1",
      "mt-2",
      "mt-5",
      "text-base-plus",
      "text-md",
      "text-sm",
      "text-text-muted",
      "text-text-secondary",
      "truncate",
    ],
  },

  "pages/ScheduledPage.vue": {
    reason:
      "Thirteen Tailwind utilities carried verbatim from the `ScheduledPage` markup (line 53 `dest-create space-y-3`, line 54 `text-md-plus font-medium`, line 70 `flex flex-wrap items-end gap-3`, line 71 `min-w-[160px] flex-1`, line 117 `text-base-plus font-medium`, line 128 `min-w-0 truncate`, line 134 `dest-row-meta line-clamp-2`). No stylesheet in this tree defines any of them (verified: no rule prelude in this tree), while Tailwind emits them from these source files into the built `out/renderer/assets/*.css`, so they are styled in the running app and only invisible to this hand-written-partials scan. Same situation as the `PullRequestsPage.vue`, `ComposerModelPicker.vue` and `ComposerToolbar.vue` entries above. The page's semantic classes (`thread-scroll`, `page-frame`, `page-header`, `page-title`, `dest-create`, `dest-section-label`, `dest-list`, `dest-row*`, `page-card`, `page-empty*`, `field-input`, `field-textarea`, `field-select`, `btn*`, `badge*`, `block`, `space-y-1.5`, `text-sm`, `text-xs`, `text-text-secondary`, `text-text-muted`, `px-2.5`, `py-1`) are defined by `styles/destinations.css`, `styles/chat-shell.css`, `styles/ui-kit.css` and `styles/composer.css` and are deliberately not listed here.",
    classes: [
      "flex",
      "flex-1",
      "flex-wrap",
      "font-medium",
      "gap-3",
      "items-end",
      "line-clamp-2",
      "min-w-0",
      "min-w-[160px]",
      "space-y-3",
      "text-base-plus",
      "text-md-plus",
      "truncate",
    ],
  },

  "components/ToolDetails.vue": {
    reason:
      "`sr-only` is the Tailwind accessibility utility the markup used for the screen-reader-only channel name of a plain (run-row) block body. No stylesheet in this tree defines it (verified: no rule prelude in this tree), while Tailwind emits it into the built `out/renderer/assets/*.css`, so it is styled in the running app and only invisible to this hand-written-partials scan. Same exemption as the `StartupSplash` / `NotificationCenter` / `Sidebar` / `PlanApprovalBar` entries above. Every other class this file renders (`tool-block`, `is-plain`, `tool-row-section-head`, `tool-row-copy`, `copied`, `tool-row-content`, `is-error`, `tool-diff`, `diff-hunk`, `diff-line`, `diff-line-sign`, `diff-line-text`, `tool-block-more`, `tool-file-list`, `tool-file-item`, `is-linked`, `tool-match-list`, `tool-match-group`, `tool-match-path`, `tool-match-line`, `tool-match-line-no`, `tool-match-line-text`, `tool-fields`, `tool-field`, `tool-field-label`, `tool-field-value`, `tool-note`, `tool-note-text`, `tool-row-chips`, `tool-chip`) is defined by `styles/messages.css` and is deliberately not listed here.",
    classes: ["sr-only"],
  },

  "components/PermissionCard.vue": {
    reason:
      "`text-text-primary` is the Tailwind text-color utility the markup applied to the highlighted tool name inside the allow prompt (the `components={{ highlight: <span className=\"text-text-primary\" /> }}` map). No stylesheet in this tree defines it (verified: no rule prelude in this tree), while Tailwind emits it into the built `out/renderer/assets/*.css`, so it is styled in the running app and only invisible to this hand-written-partials scan. Same exemption as the `ErrorBoundary.vue` / `OnboardingChecklist.vue` entries above. Every other class this file renders (`permission-card`, `risk-*`, `permission-risk`, `permission-body`, `permission-tool`, `permission-args`, `permission-question`, `permission-countdown`, `permission-actions`) is defined by `styles/messages.css` and is deliberately not listed here.",
    classes: ["text-text-primary"],
  },

  "features/chat/transcript/ToolRow.vue": {
    reason:
      "Two groups. `sr-only` is the Tailwind accessibility utility the markup used twice (the screen-reader-only delegate label and count). `status-running` / `status-success` / `status-error` / `status-denied` are the four values of the interpolated status class on the root element (built with a template literal, so no literal occurrence appears in the markup); no stylesheet in this tree ever defined a rule for any of them — the row is coloured through `.tool-row-state.is-error` / `.is-done` / `.is-running` instead, so these four classes are inert in the reference too. This component keeps them because this contract exists to catch *invented* names, and dropping them would diverge from the rendered DOM for no visual change. Neither group has a rule prelude in `src/renderer/styles/*.css`; `sr-only` is emitted by Tailwind into the built `out/renderer/assets/*.css`, same exemption as the `StartupSplash` / `Sidebar` / `ToolDetails.vue` entries above. Every other class this file renders (`tool-row`, `subagent-topology-node`, `open`, `outcome-*`, `tool-row-head`, `is-run`, `tool-row-header`, `tool-row-icon`, `is-subagent`, `tool-row-name`, `running`, `tool-row-agent`, `is-count`, `tool-row-summary`, `linked`, `tool-row-state`, `tool-row-state-dot`, `tool-row-status`, `tool-row-caret`, `is-toggle`, `tool-row-body`, `subagent-topology-*`) is defined by `styles/messages.css` and is deliberately not listed here.",
    classes: ["sr-only", "status-running", "status-success", "status-error", "status-denied"],
  },

  "features/chat/transcript/HostedSearchRow.vue": {
    reason:
      "`hosted-search` is the second class on the row's root element in the reference markup (`` className={`tool-row hosted-search ${open ? \"open\" : \"\"}`} ``). It is inert in the reference too: verified no rule prelude for `.hosted-search` (as opposed to `.hosted-search-query` / `-sources` / `-source-title` / `-source-host` / `-more`) in `src/renderer/styles/*.css`, so the row is styled entirely through `.tool-row*` plus the four payload classes that do have rules. Keeping the name matches the rendered DOM. Same exemption as the `ToolRow.vue` / `ActivityGroup.vue` entries above. Every other class this file renders (`tool-row`, `open`, `tool-row-header`, `tool-row-icon`, `tool-row-name`, `running`, `turn-process-error`, `tool-row-summary`, `tool-row-caret`, `tool-row-body`, `selectable`, `hosted-search-query`, `hosted-search-sources`, `hosted-search-source-title`, `hosted-search-source-host`, `hosted-search-more`) is defined by `styles/messages.css` and is deliberately not listed here.",
    classes: ["hosted-search"],
  },
  "features/plugins/ServiceChips.vue": {
    reason:
      "Two inert names. `is-stopped` is one value of the state modifier the Vue component spells as an object of literal names (built with a template literal in the reference); `.plugins-service-chip` already carries the stopped colour, so no rule ever targeted it in this tree. `plugins-service-name` is a literal class in the reference markup that no stylesheet in this tree ever defined — the row is styled through `.plugins-service-chip` and `.plugins-service-state` / `.plugins-service-restarts` (`styles/plugins.css:594-638`). Verified: no rule prelude for either name in this tree. Every other class this file renders (`plugins-service-chips`, `plugins-service-chip`, `is-running`, `is-starting`, `is-failed`, `plugins-service-dot`, `plugins-service-state`, `plugins-service-restarts`) is defined by `styles/plugins.css` and is deliberately not listed here.",
    classes: ["is-stopped", "plugins-service-name"],
  },

  "features/chat/transcript/ActivityGroup.vue": {
    reason:
      "The seven `phase-*` names are inert in this tree: they are the values of the activity-phase modifier, and the phase surfaces through the activity indicator's `data-phase` attribute and its label text rather than through these class names, so no rule prelude for any of them exists in `src/renderer/styles/*.css`. The Vue component spells the phase as an object of literal names because the class contract reads literal names and reports the `phase-` fragment of a template literal as an undefined class; keeping the names matches the rendered DOM. Same exemption as the `ToolRow.vue` / `PermissionCard.vue` entries above. The embedded root's `turn-process-activity` used to be listed here and is not any more: it has a rule in `styles/messages.css` now, because without one the div was sized to max-content inside the flex-start assistant column and a single long tool line widened the column past its clip.",
    classes: [
      "phase-compacting",
      "phase-preparing",
      "phase-recovering",
      "phase-retrying",
      "phase-starting",
      "phase-waiting-model",
      "phase-waiting-subagents",
    ],
  },

  "components/settings/PluginScenicThemesDestination.vue": {
    reason:
      "`sr-only` is the Tailwind accessibility utility the markup used for the screen-reader-only destination description. No stylesheet in this tree defines it, while Tailwind emits it into the built `out/renderer/assets/*.css`, so it is styled in the running app and only invisible to this hand-written-partials scan. Same exemption as the `StartupSplash.vue` / `ToolDetails.vue` / `PermissionCard.vue` entries above. Every other class this file renders is defined by `styles/destinations.css` and is deliberately not listed here.",
    classes: ["sr-only"],
  },
  "components/settings/AgentProjectPicker.vue": {
    reason:
      "`agent-capability-project-select` is a literal class in the reference markup that no stylesheet in this tree ever defines — the select is styled through the surrounding `.agent-capability-*` rules. Verified: no rule prelude for the name in this tree. Keeping it matches the rendered DOM. Every other class this file renders is defined by `styles/destinations.css` and is deliberately not listed here.",
    classes: ["agent-capability-project-select"],
  },

  "components/settings/CapabilityPanel.vue": {
    reason:
      "`sr-only` is the Tailwind accessibility utility the markup used for the screen-reader-only panel heading. No stylesheet in this tree defines it, while Tailwind emits it into the built `out/renderer/assets/*.css`, so it is styled in the running app and only invisible to this hand-written-partials scan. Same exemption as the `StartupSplash.vue` / `ToolDetails.vue` / `PermissionCard.vue` / `PluginScenicThemesDestination.vue` entries above. Every other class this file renders is defined by `styles/destinations.css` and is deliberately not listed here.",
    classes: ["sr-only"],
  },

  "components/settings/CapabilitySkeleton.vue": {
    reason:
      "`sr-only` is the Tailwind accessibility utility the markup used for the screen-reader-only loading announcement. No stylesheet in this tree defines it, while Tailwind emits it into the built `out/renderer/assets/*.css`, so it is styled in the running app and only invisible to this hand-written-partials scan. Same exemption as the `StartupSplash.vue` / `ToolDetails.vue` / `PermissionCard.vue` / `CapabilityPanel.vue` entries above. Every other class this file renders is defined by `styles/destinations.css` and is deliberately not listed here.",
    classes: ["sr-only"],
  },
  "components/extensions/KeyValueRows.vue": {
    reason:
      "`is-first` marks the first key/value row (applied as `index === 0 && \"is-first\"`). No stylesheet in this tree ever defines a rule for it — the row separator is drawn by `.key-value-row + .key-value-row` instead — so the name is inert in the reference too. Keeping it matches the rendered DOM. Every other class this file renders is defined by `styles/extensions.css` and is deliberately not listed here.",
    classes: ["is-first"],
  },

  "components/extensions/ScopeControl.vue": {
    reason:
      "`is-projects` is one value of the scope modifier the Vue component spells as an object of literal names; it is built with a template literal in the reference markup, so no literal occurrence appears there. No stylesheet in this tree defines a rule for it. Keeping it matches the rendered DOM. Every other class this file renders is defined by `styles/extensions.css` and is deliberately not listed here.",
    classes: ["is-projects"],
  },

  "components/settings/AgentSubagentsPage.vue": {
    reason:
      "`agent-subagents-page` is a literal class in the reference markup that no stylesheet in this tree ever defines — the page is laid out by the shared `.agent-capability-*` rules. Keeping it matches the rendered DOM. Every other class this file renders is defined by `styles/destinations.css` and is deliberately not listed here.",
    classes: ["agent-subagents-page"],
  },

  "components/settings/ModelSelectionPanes.vue": {
    reason:
      "Tailwind type and layout utilities (`text-sm`, and the sibling utilities the panes use) carried over verbatim from the markup, which the stylesheet never defined. Tailwind emits them into the built `out/renderer/assets/*.css`, so they are styled in the running app and only invisible to this hand-written-partials scan. Same exemption as the `Button.vue` / `Field.vue` / `ErrorBoundary.vue` entries above. Every other class this file renders is defined by `styles/model-config.css` and is deliberately not listed here.",
    classes: ["text-sm"],
  },

  "components/settings/OAuthLoginDialog.vue": {
    reason:
      "`oauth-answer-input` is a literal class in the reference markup that no stylesheet in this tree ever defines. `text-sm-plus` is one of the two utilities applied to the manual-code input via `cx`; the Vue component spells them as separate object keys so the class contract sees real names. No stylesheet in this tree defines a `.text-sm-plus` *class* rule (only the `--text-sm-plus` design token, which is a variable, not a class), while Tailwind emits the utility class into the built `out/renderer/assets/*.css`, same exemption as the entries above. `font-mono` is deliberately not listed: `.vendor-account-row .font-mono` (`styles/providers.css:1365`) defines it, so it is already covered. Every other class this file renders is defined by `styles/providers.css` and is deliberately not listed here.",
    classes: ["oauth-answer-input", "text-sm-plus"],
  },

  "components/settings/RemoteHostsPage.vue": {
    reason:
      "`text-sm` / `text-text-secondary` are Tailwind utilities on the auth-mode label, emitted into the built `out/renderer/assets/*.css` — same exemption as the `Field.vue` / `Button.vue` entries above. Every other class this file renders is defined by `styles/settings.css` or `styles/ui-kit.css` and is deliberately not listed here: `is-online` by `.settings-remote-host-pulse.is-online`, `settings-remote-host-form` and the rest by the remote-host block, and the password reveal control by `.password-input*`.",
    classes: ["text-sm", "text-text-secondary"],
  },

  "components/settings/SubagentFallbackModels.vue": {
    reason:
      "Tailwind layout and type utilities carried over verbatim from the markup (`break-all`, `flex`, `flex-1`, `gap-2`, `items-center`, `min-w-0`, `space-y-2`, `text-sm`), which the stylesheet never defined. Tailwind emits them into the built `out/renderer/assets/*.css`, so they are styled in the running app and only invisible to this hand-written-partials scan. Same exemption as the `Button.vue` / `Field.vue` / `ErrorBoundary.vue` / `ModelSelectionPanes.vue` entries above. Every other class this file renders is defined by `styles/settings.css` and is deliberately not listed here.",
    classes: [
      "break-all",
      "flex",
      "flex-1",
      "gap-2",
      "items-center",
      "min-w-0",
      "space-y-2",
      "text-sm",
    ],
  },

  "features/settings/CloseBehaviorSection.vue": {
    reason:
      "`settings-command-shell-state` is a literal class in the reference markup that no stylesheet in this tree ever defines — the state is expressed through the surrounding `.settings-command-shell-*` rules. Keeping it matches the rendered DOM. Every other class this file renders is defined by `styles/settings.css` and is deliberately not listed here.",
    classes: ["settings-command-shell-state"],
  },

  "features/settings/McpScanImportPanel.vue": {
    reason:
      "`import-group-body` / `import-group-title` are literal classes in the reference markup that no stylesheet in this tree ever defines. `settings-description` is likewise carried over from the reference markup. Keeping them matches the rendered DOM. Every other class this file renders is defined by `styles/settings.css` and is deliberately not listed here.",
    classes: ["import-group-body", "import-group-title", "settings-description"],
  },

  "features/settings/ModelConfigImportPanel.vue": {
    reason:
      "`import-group-body` is a literal class in the reference markup that no stylesheet in this tree ever defines — the panel body is styled through the shared `.import-group` wrapper. Keeping it matches the rendered DOM. Every other class this file renders is defined by `styles/settings.css` and is deliberately not listed here.",
    classes: ["import-group-body"],
  },

  "features/settings/SessionImportPanel.vue": {
    reason:
      "`import-group-body` is a literal class in the reference markup that no stylesheet in this tree ever defines — the panel body is styled through the shared `.import-group` wrapper. Keeping it matches the rendered DOM. Every other class this file renders is defined by `styles/settings.css` and is deliberately not listed here.",
    classes: ["import-group-body"],
  },

  "features/settings/SkillsScanImportPanel.vue": {
    reason:
      "Three names carried over verbatim from the reference markup: `import-group-body`, `import-group-title` and `settings-description`. None has a rule prelude in `src/renderer/styles/*.css` — the panels are styled through the shared `.import-group` and `.settings-*` wrappers. Keeping them matches the rendered DOM. (`settings-hint` was the fourth until `b8daa88a` moved the scan-mode sentence onto the row's help icon.) Every other class this file renders is defined by `styles/settings.css` and is deliberately not listed here.",
    classes: [
      "import-group-body",
      "import-group-title",
      "settings-description",
    ],
  },

  "features/settings/UpdatesRow.vue": {
    reason:
      "Tailwind layout and type utilities carried over verbatim from the markup (`flex`, `flex-col`, `gap-1.5`, `items-end`, `text-right`, `text-text-muted`, `text-xs-plus`), which the stylesheet never defined. Tailwind emits them into the built `out/renderer/assets/*.css`, so they are styled in the running app and only invisible to this hand-written-partials scan. Same exemption as the `Field.vue` / `UpdateBanner.vue` / `SubagentFallbackModels.vue` entries above. Every other class this file renders is defined by `styles/settings.css` and is deliberately not listed here.",
    classes: [
      "flex",
      "flex-col",
      "gap-1.5",
      "items-end",
      "text-right",
      "text-text-muted",
      "text-xs-plus",
    ],
  },

  "components/settings/AgentMcpPage.vue": {
    reason:
      "`is-status` is a literal class in the reference markup (lines 525, 533 and 537 — `cx(\"agent-capability-badge\", \"is-status\", ...)` and the two static `agent-capability-badge is-status is-failed` / `… is-ready` badges). No stylesheet in this tree ever defines a rule for it (verified: no rule prelude in this tree) — the badge is coloured by the sibling `is-ready` / `is-connecting` / `is-failed` modifiers, which `styles/settings.css:1680-1697` does define and which are deliberately not listed here. Keeping `is-status` matches the rendered DOM. Every other class this file renders is defined by `styles/settings.css` and is deliberately not listed here.",
    classes: ["is-status"],
  },
  "components/workpanel/FilesTab.vue": {
    reason:
      "`file-viewer-markdown` is a literal class in the reference markup (`className=\"file-viewer-markdown prose-chat\"`) that no stylesheet in this tree ever defines — the viewer body is styled through the shared `.file-viewer-*` rules and the markdown itself through `.prose-chat` (`styles/prose.css:15`). Verified: no rule prelude for the name in this tree. Keeping it matches the rendered DOM. Every other class this file renders (`file-tree`, `file-tree-row`, `file-tree-caret`, `file-tree-name`, `file-tree-note`, `file-viewer`, `file-viewer-header`, `file-viewer-path`, `file-viewer-size`, `file-viewer-body`, `file-viewer-code`, `file-viewer-line`, `file-viewer-cap`, `file-viewer-image`, `prose-chat`, `icon-btn`, `icon-btn-square`) is defined by `styles/work-panel.css`, `styles/prose.css`, `styles/composer.css` or `styles/ui-kit.css` and is deliberately not listed here.",
    classes: ["file-viewer-markdown"],
  },
  "components/workpanel/SubagentPanel.vue": {
    reason:
      "`sr-only` is the Tailwind accessibility utility the markup used for the screen-reader-only dock heading. No stylesheet in this tree defines it (verified: no rule prelude in this tree), while Tailwind emits it into the built `out/renderer/assets/*.css`, so it is styled in the running app and only invisible to this hand-written-partials scan. Same exemption as the `StartupSplash.vue` / `ToolDetails.vue` / `PermissionCard.vue` entries above. Every other class this file renders (`subagent-panel`, `subagent-panel-scroll`, `subagent-panel-jump`, `subagent-panel-empty`, `jump-latest-btn`) is defined by `styles/work-panel.css` or `styles/chat-shell.css` and is deliberately not listed here.",
    classes: ["sr-only"],
  },

  "features/chat/transcript/AssistantTurn.vue": {
    reason:
      "`assistant-turn` is a literal class in the reference markup (the `message-row assistant assistant-turn` literal in the root's className template). No stylesheet in this tree ever defines a rule for it (verified: no rule prelude in this tree) — the row is styled through `.message-row` / `.message-row.assistant` (`styles/messages.css:7,53`) and the process disclosure through `.turn-process-*` (`styles/messages.css:2968` matches the sibling `assistant-turn-fragment`, which is deliberately not listed here). The Vue component spells the same element as a static `class` plus an object `:class` binding, which is what the contract reads, and keeps the name to match the rendered DOM. Same exemption as the `ToolRow.vue` / `ActivityGroup.vue` entries above.",
    classes: ["assistant-turn"],
  },
  "features/chat/transcript/CompactionRow.vue": {
    reason:
      "`transcript-compaction-label` is a literal class in the reference markup (`className=\"transcript-compaction-label\"`). No stylesheet in this tree ever defines a rule for it (verified: no rule prelude in this tree) — the label inherits the row's own type from `.transcript-compaction-row` (`styles/messages.css:1312`) and only the sibling detail span has a rule (`.transcript-compaction-detail`, line 1328). Keeping it matches the rendered DOM. Same exemption as the `MessageMeta.vue` `throughput` entry above.",
    classes: ["transcript-compaction-label"],
  },

  "components/settings/FontFamilyRow.vue": {
    reason:
      "`settings-font-viewport` is a literal class in the reference markup (`className=\"settings-font-viewport\"`) that no stylesheet in this tree defines (verified: no rule prelude in `src/renderer/styles/*.css`). The scroll container is styled through its own children instead — `.settings-font-family-list` and the option rows. Keeping it matches the rendered DOM. Every other class this file renders is defined by `styles/settings.css` and is deliberately not listed here.",
    classes: ["settings-font-viewport"],
  },
  "components/settings/ProviderSetupDialog.vue": {
    reason:
      "Six names in two groups, both carried over verbatim from the reference markup and absent from `src/renderer/styles/*.css` (verified: no rule prelude in this tree). `provider-setup-overlay` is the dialog's own overlay modifier on top of the defined `.overlay`; `provider-setup-service` / `provider-setup-service-row` are the two classes the service field row carries alongside the defined `.provider-setup-field-row`. `is-custom` / `is-named` are the two values of the `provider-setup-fields` state modifier, which the Vue component spells as object keys so the contract reads literal names rather than a glued fragment. `text-sm-plus` is a Tailwind utility: no `.text-sm-plus` *class* rule exists in this tree (only the `--text-sm-plus` design token, a custom property, `tokens.css:343`), while Tailwind emits the utility class into the built `out/renderer/assets/*.css` (verified present), so it is styled in the running app and only invisible to this hand-written-partials scan — same exemption as the `OAuthLoginDialog.vue` / `ModelSelectionPanes.vue` / `RemoteHostsPage.vue` entries above. (`settings-hint` was the seventh until `b8daa88a` moved the copy-provider sentence onto the title's help icon.) Every other class this file renders is defined by `styles/providers.css` or `styles/settings.css` and is deliberately not listed here.",
    classes: [
      "is-custom",
      "is-named",
      "provider-setup-overlay",
      "provider-setup-service",
      "provider-setup-service-row",
      "text-sm-plus",
    ],
  },

  "components/settings/ModelConfigPage.vue": {
    reason:
      "`model-default-panel` and `model-default-label` are the two modifiers the reference markup carries alongside the defined `.settings-panel` / `.settings-row-title` (lines 309 and 312), and no stylesheet in this tree defines them (verified: no rule prelude in `src/renderer/styles/*.css`). Keeping them matches the rendered DOM. Every other class this file renders is defined by `styles/settings.css` or `styles/model-config.css` and is deliberately not listed here.",
    classes: ["model-default-label", "model-default-panel"],
  },
  "components/settings/VendorAccountDialog.vue": {
    reason:
      "`vendor-account-overlay` is the dialog's own modifier on top of the defined `.overlay`, carried over verbatim from the reference markup (`className=\\\"overlay vendor-account-overlay\\\"`); no stylesheet in this tree defines it. Every other class this file renders is defined by `styles/settings.css` or `styles/providers.css` and is deliberately not listed here.",
    classes: ["vendor-account-overlay"],
  },
  "components/settings/VendorAccountsSection.vue": {
    reason:
      "`vendor-accounts-block` is the block modifier the reference markup carries alongside the defined `.settings-card-block`, and no stylesheet in this tree defines it. Every other class this file renders is defined by `styles/settings.css` or `styles/providers.css` and is deliberately not listed here.",
    classes: ["vendor-accounts-block"],
  },
  "pages/SettingsPage.vue": {
    reason:
      "Two groups, both carried over verbatim from the reference markup. `settings-permission-select` is a literal in the reference markup (line 362) that no stylesheet in this tree defines. `font-medium`, `text-text-muted` and `text-xs-plus` are Tailwind utilities applied to the About meta block (lines 474 and 477); no `.text-xs-plus` *class* rule exists in this tree (only the `--text-xs-plus` design token, a custom property, `tokens.css:341`), while Tailwind emits the utility into the built `out/renderer/assets/*.css`, so it is styled in the running app and only invisible to this hand-written-partials scan — same exemption as the `ProviderSetupDialog.vue` entry above. Every other class this page renders is defined by `styles/settings.css` or `styles/chat-shell.css` and is deliberately not listed here.",
    classes: [
      "font-medium",
      "settings-permission-select",
      "text-text-muted",
      "text-xs-plus",
    ],
  },

  "features/settings/PromptEnhancementCard.vue": {
    reason:
      "`settings-command-shell-state` is the state-text modifier the reference markup carries on the three inline validation lines (missing draft variable, over-long template, save error). No stylesheet in this tree defines it — the state colour comes from the sibling `.error` class, which `styles/ui-kit.css` defines for the shared error tone. Same exemption as the `CommandShellRow.vue` / `LargePasteThresholdRow.vue` / `CloseBehaviorSection.vue` entries above. Every other class this file renders (`settings-card-block`, `settings-card-heading`, `settings-panel`, `settings-row*`, `settings-toggle*`, `settings-icon-button`, `overlay`, `ext-sheet-overlay`, `dialog`, `ext-sheet*`, `field-textarea`, `ext-skill-body`, `settings-panel-actions`, `btn*`, `error`) is defined by `styles/settings.css`, `styles/extensions.css` or `styles/ui-kit.css` and is deliberately not listed here.",
    classes: ["settings-command-shell-state"],
  },
};

/** Every file under `dir` whose name passes `matches`. */
export function walk(dir, matches) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path, matches);
    return matches(entry.name) ? [path] : [];
  });
}

/** Renderer-relative path with forward slashes, so keys are platform-stable. */
export function rendererPath(root, file) {
  return file.slice(root.length).split("\\").join("/");
}

/**
 * Class names defined by a stylesheet.
 *
 * Comments, attribute selectors and string literals are dropped first: `.btn`
 * must be found in `.btn {`, not in `[data-surface="plugin-launcher"]` or an
 * `@import "./x.css"` path. Stripping string literals also keeps a declaration
 * like `content: "{"` from being read as a rule prelude.
 *
 * At-rule preludes are skipped, which is what makes nested blocks work: in
 * `@media (min-width: 600px) { .a { } }` the first prelude is the `@media` line
 * and the next one is `.a`.
 */
export function definedClasses(stylesheet) {
  const out = new Set();
  const css = stylesheet
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/"[^"]*"|'[^']*'/g, " ");
  for (const match of css.matchAll(/([^{}]+)\{/g)) {
    const prelude = match[1];
    if (/^\s*@/.test(prelude)) continue;
    for (const hit of prelude.matchAll(/\.([A-Za-z_][\w-]*)/g)) out.add(hit[1]);
  }
  return out;
}

/**
 * The `<template>` block of an SFC, or "" when it has none.
 *
 * Anchored to a line start: an SFC's prose comments talk *about* templates
 * (`ActivityGroup.vue` writes "inside a `<template>` fragment"), and a bare
 * `indexOf("<template")` would start the block there, sweeping the whole
 * `<script>` into the scan and reporting every class named in a string.
 */
export function templateOf(source) {
  const match = source.match(/^<template\b[^>]*>\r?\n([\s\S]*?)\r?\n<\/template>\s*$/m);
  return match ? match[1] : "";
}

/** Split a class list on whitespace, ignoring empties. */
function addTokens(out, text) {
  for (const token of text.split(/\s+/)) if (token) out.add(token);
}

/**
 * Classes carried by a backtick template literal.
 *
 * Two halves, both needed:
 *  - the quoted strings inside `${...}` are complete class names, so
 *    `` `opt ${active ? 'is-active' : ''}` `` yields `is-active`;
 *  - the static text outside the interpolations is class names too.
 *
 * Static text is kept verbatim, including a fragment glued to an interpolation
 * like the `opt-` in `` `opt-${id}` ``. That fragment is not really a class
 * name, so reporting it is a deliberate over-report: the alternative is to skip
 * it, and a skipped fragment is a *silent* miss when the concatenation produces
 * an invented class. The remedy is also the idiom this port wants anyway —
 * a static `class` plus an object `:class` binding — which the parsers read
 * exactly. Under-reporting would let real drift through, so the guard leans the
 * other way.
 */
function addTemplateLiteralClasses(out, expression) {
  for (const literal of expression.matchAll(/`([^`]*)`/g)) {
    const body = literal[1];
    for (const segment of body.split(/\$\{[^}]*\}/)) addTokens(out, segment);
    for (const interpolation of body.matchAll(/\$\{([^}]*)\}/g)) {
      for (const quoted of interpolation[1].matchAll(/['"]([^'"]*)['"]/g)) {
        addTokens(out, quoted[1]);
      }
    }
  }
}

/**
 * Classes contributed by a `:class` binding.
 *
 * Three forms, each handled where it is unambiguous:
 *  - object literals contribute their *keys*, so `{ active: index === 0 }`
 *    yields `active` and not `index` or `0`;
 *  - quoted strings outside braces are class names, so `cond ? 'a' : 'b'` and
 *    `['a', cond && 'b']` both work;
 *  - backtick template literals are parsed as above.
 *
 * Reading the whole expression as a class list would report identifiers and
 * operators as undefined classes; reading only quoted strings would miss
 * object keys.
 */
export function addDynamicClasses(out, expression) {
  addTemplateLiteralClasses(out, expression);
  const rest = expression.replace(/\{([^{}]*)\}/g, (_whole, inner) => {
    for (const match of inner.matchAll(
      /(?:^|,)\s*(?:'([^']*)'|"([^"]*)"|([A-Za-z_][\w-]*))\s*:/g,
    )) {
      const name = match[1] ?? match[2] ?? match[3];
      if (name) out.add(name);
    }
    return " ";
  });
  for (const match of rest.matchAll(/['"]([^'"]*)['"]/g)) addTokens(out, match[1]);
}

/** Every class name a template can render. */
export function usedClasses(template) {
  const out = new Set();
  // The lookbehind keeps `:class` / `v-bind:class` out of the static matches;
  // those bindings are handled below, where their expression is parsed.
  for (const match of template.matchAll(/(?<![:\w-])class\s*=\s*"([^"]*)"/g)) {
    addTokens(out, match[1]);
  }
  for (const match of template.matchAll(/(?<![:\w-])class\s*=\s*'([^']*)'/g)) {
    addTokens(out, match[1]);
  }
  for (const match of template.matchAll(/(?::|v-bind:)class\s*=\s*"([^"]*)"/g)) {
    addDynamicClasses(out, match[1]);
  }
  for (const match of template.matchAll(/(?::|v-bind:)class\s*=\s*'([^']*)'/g)) {
    addDynamicClasses(out, match[1]);
  }
  return out;
}
