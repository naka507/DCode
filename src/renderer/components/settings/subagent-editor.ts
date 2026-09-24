/**
 * Pure helpers for the subagent editor sheet.
 *
 * Holds the draft type, the starter document, the tool-grant split/merge, the
 * preset copy table, the slug mirror of host-core and the validation rule. The
 * sheet itself lives in `components/settings/SubagentEditorSheet.vue`, which
 * re-exports every name here so a consumer keeps importing from one specifier.
 *
 * Framework-free, and the `@dcode/shared` import is the only dependency.
 */
import {
  DEFAULT_SUBAGENT_TOOLS,
  GLOBAL_SCOPE,
  MAX_SUBAGENT_MAX_TOKENS,
  SUBAGENT_INHERIT_TOKEN,
  findSubagentPreset,
  isSubagentAssignableTool,
  resolveScope,
  type ActivationScope,
  type SubagentDefinition,
  type SubagentPreset,
  type SubagentThinkingLevel,
  type UserSubagentRecord,
} from "@dcode/shared";

import { subagentModelPinParts } from "./subagent-models";

/** Hard cap host-core enforces on a definition document. */
export const MAX_SUBAGENT_BYTES = 32 * 1024;

export type SubagentDraft = {
  id: string;
  name: string;
  description: string;
  /** Assignable extras. May be empty when `inheritTools` is on. */
  tools: string[];
  /** Frontmatter `tools: inherit` — union the parent session catalog. */
  inheritTools: boolean;
  /** `<provider>/<model>`, or empty for "same model as this session". */
  model: string;
  fallbackModels: string[];
  /** Empty means "whatever the session uses". */
  thinkingLevel: SubagentThinkingLevel | "";
  /**
   * Output-token cap for one delegate response. `0` means "follow the model's
   * published limit", which is what a definition without `maxTokens` gets.
   */
  maxTokens: number;
  body: string;
  enabled: boolean;
  scope: ActivationScope;
};

/** Split a stored tools list into the inherit flag and assignable extras. */
export function splitSubagentToolGrant(tools: readonly string[]): {
  inheritTools: boolean;
  tools: string[];
} {
  const inheritTools = tools.some((name) => name === SUBAGENT_INHERIT_TOKEN);
  const assignable = tools.filter((name) => isSubagentAssignableTool(name));
  return {
    inheritTools,
    tools:
      assignable.length > 0 || inheritTools
        ? assignable
        : [...DEFAULT_SUBAGENT_TOOLS],
  };
}

/** Frontmatter `tools` list written on save. */
export function mergeSubagentToolGrant(
  inheritTools: boolean,
  tools: readonly string[],
): string[] {
  return inheritTools ? [SUBAGENT_INHERIT_TOKEN, ...tools] : [...tools];
}

/**
 * The starter document. A subagent's body is its whole system prompt, so the
 * template is written as instructions to the delegate rather than as notes about
 * it — the difference between the two is the most common way a definition ends
 * up not working.
 */
export function subagentTemplate(name: string): string {
  const title = name.trim() || "this delegate";
  return `You are ${title}, working on one task for another agent.

## What to do
Describe the job in the imperative: what to look at, in what order, when to stop.

## What to report back
Say exactly what the answer should look like — the parent agent only sees your
final message, not your steps.

## Limits
Anything you must not do.
`;
}

/** A "blank" starter so users who ignore the preset chips are not stuck. */
export const BLANK_SUBAGENT_PRESET_ID = "" as const;

/**
 * Catalog keys for each built-in preset. Hyphenated ids (`code-reviewer`)
 * cannot be turned into keys by capitalizing the first letter — the hyphen
 * stays in the middle of the key, which is not in the catalog.
 */
export const SUBAGENT_PRESET_COPY = {
  explorer: { name: "presetExplorerName", desc: "presetExplorerDesc" },
  "code-reviewer": { name: "presetReviewerName", desc: "presetReviewerDesc" },
  "test-runner": { name: "presetTestRunnerName", desc: "presetTestRunnerDesc" },
  fixer: { name: "presetFixerName", desc: "presetFixerDesc" },
  "ui-designer": { name: "presetUiDesignerName", desc: "presetUiDesignerDesc" },
} as const satisfies Record<SubagentPreset["id"], { name: string; desc: string }>;

/** Full i18n path for a preset chip, or null when `id` is blank / unknown. */
export function subagentPresetCopyKey(
  id: string,
  kind: "name" | "desc",
): string | null {
  if (!Object.hasOwn(SUBAGENT_PRESET_COPY, id)) return null;
  const entry = SUBAGENT_PRESET_COPY[id as keyof typeof SUBAGENT_PRESET_COPY];
  return `extensions.subagents.${entry[kind]}`;
}

export function emptySubagentDraft(): SubagentDraft {
  return {
    id: "",
    name: "",
    description: "",
    tools: [...DEFAULT_SUBAGENT_TOOLS],
    inheritTools: false,
    model: "",
    fallbackModels: [],
    thinkingLevel: "",
    maxTokens: 0,
    body: "",
    enabled: true,
    scope: GLOBAL_SCOPE,
  };
}

export function draftFromRecord(record: UserSubagentRecord, body: string): SubagentDraft {
  const grant = splitSubagentToolGrant(record.tools);
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? "",
    tools: grant.tools,
    inheritTools: grant.inheritTools,
    model: record.model ?? "",
    fallbackModels: [...(record.fallbackModels ?? [])],
    thinkingLevel: record.thinkingLevel ?? "",
    maxTokens: record.maxTokens ?? 0,
    body,
    enabled: record.enabled,
    scope: resolveScope(record.scope),
  };
}

/** Prefill the create sheet from a shipped definition (Copy as mine). */
export function draftFromDefinition(definition: SubagentDefinition): SubagentDraft {
  const preset = findSubagentPreset(definition.name);
  const grant = splitSubagentToolGrant(
    definition.inheritTools
      ? [SUBAGENT_INHERIT_TOKEN, ...definition.tools]
      : definition.tools,
  );
  return {
    ...emptySubagentDraft(),
    name: preset?.name ?? definition.name,
    description: definition.description,
    tools: grant.tools,
    inheritTools: grant.inheritTools,
    model: definition.model
      ? `${definition.model.providerId}/${definition.model.modelId}`
      : "",
    fallbackModels: (definition.fallbackModels ?? []).map(
      (pin) => `${pin.providerId}/${pin.modelId}`,
    ),
    thinkingLevel: definition.thinkingLevel ?? "",
    maxTokens: definition.maxTokens ?? 0,
    body: definition.prompt,
  };
}

/** Mirror of host-core's `normalize_name`, so the handle shown is the one stored. */
export function subagentSlug(value: string): string {
  let slug = "";
  let lastDash = false;
  for (const char of value.trim().toLocaleLowerCase()) {
    if (/[a-z0-9]/.test(char)) {
      slug += char;
      lastDash = false;
    } else if (slug && !lastDash) {
      slug += "-";
      lastDash = true;
    }
  }
  return slug.slice(0, 40).replace(/-+$/, "");
}

/**
 * Apply a built-in preset to a draft. Tool grants are replaced wholesale so a
 * preset that drops `Bash` truly drops it. Body and description are
 * overwritten — these are the values that make the preset worth picking.
 * Inherit is cleared: presets are the built-in delegates, not parent-catalog
 * workers.
 */
export function applySubagentPreset(draft: SubagentDraft, preset: SubagentPreset): SubagentDraft {
  return {
    ...draft,
    name: preset.name,
    description: preset.description,
    tools: [...preset.tools],
    inheritTools: false,
    body: preset.body,
  };
}

/** Clear the template-owned fields while preserving the user's model choices. */
export function resetSubagentTemplate(draft: SubagentDraft): SubagentDraft {
  return {
    ...draft,
    name: "",
    description: "",
    tools: [...DEFAULT_SUBAGENT_TOOLS],
    inheritTools: false,
    body: "",
  };
}

/** Returns an i18n key for the first problem, or null when the draft can save. */
export function subagentDraftError(draft: SubagentDraft): string | null {
  if (!draft.name.trim()) return "extensions.subagents.errorName";
  if (!subagentSlug(draft.name)) return "extensions.subagents.errorSlug";
  if (!draft.description.trim()) return "extensions.subagents.errorDescription";
  if (!draft.inheritTools && draft.tools.length === 0) {
    return "extensions.subagents.errorTools";
  }
  // `provider/model` is the only shape the runtime can resolve; a bare model id
  // has no provider to look up, so it would be dropped with a diagnostic nobody
  // reads. Only the slash is structural: the provider half is matched by a
  // normalized alias, and a custom endpoint's display name may contain spaces —
  // the picker offers those, so rejecting them here would make a selectable
  // option impossible to save. This shares the picker's own splitter so the two
  // can never disagree.
  if (
    [draft.model, ...draft.fallbackModels].some(
      (pin) => pin.trim() && !subagentModelPinParts(pin.trim()),
    )
  ) {
    return "extensions.subagents.errorModel";
  }
  // Cleared (`0`) is a valid state that means "no cap of our own", so only a
  // value outside the accepted range is an error. The field only produces
  // integers, so a fraction cannot reach here from the UI — the check keeps
  // the draft honest anyway.
  if (
    !Number.isInteger(draft.maxTokens) ||
    draft.maxTokens < 0 ||
    draft.maxTokens > MAX_SUBAGENT_MAX_TOKENS
  ) {
    return "extensions.subagents.errorMaxTokens";
  }
  if (!draft.body.trim()) return "extensions.subagents.errorBody";
  if (new TextEncoder().encode(draft.body).length > MAX_SUBAGENT_BYTES) {
    return "extensions.subagents.errorTooBig";
  }
  return null;
}

