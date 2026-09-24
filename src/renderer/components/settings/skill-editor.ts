/**
 * Pure helpers for the skill editor sheet.
 *
 * Holds the draft type, the starter document, the slug mirror of host-core, and
 * the validation rule. The sheet itself lives in
 * `components/settings/SkillEditorSheet.vue`.
 */
import {
  GLOBAL_SCOPE,
  resolveScope,
  type ActivationScope,
  type UserSkillRecord,
} from "@dcode/shared";

/** Hard cap host-core enforces on a skill document. */
export const MAX_SKILL_BYTES = 128 * 1024;

export type SkillDraft = {
  id: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  scope: ActivationScope;
};

/**
 * The starter document, written so the first thing the user sees is a skill that
 * would already work. An empty editor teaches nothing about the format; a
 * heading plus steps is the shape every good skill has.
 */
export function skillTemplate(name: string): string {
  const title = name.trim() || "New skill";
  return `# ${title}

## When to use this
Describe the situation that should make the model reach for this skill.

## Steps
1. ...
2. ...

## Notes
Anything the model would otherwise guess wrong.
`;
}

export function emptySkillDraft(): SkillDraft {
  return {
    id: "",
    name: "",
    description: "",
    body: "",
    enabled: true,
    scope: GLOBAL_SCOPE,
  };
}

export function draftFromSkill(record: UserSkillRecord, body: string): SkillDraft {
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? "",
    body,
    enabled: record.enabled,
    scope: resolveScope(record.scope),
  };
}

export function draftFromBuiltin(builtin: {
  id: string;
  name: string;
  description?: string;
  body?: string;
}): SkillDraft {
  const shortName = builtin.id.replace(/^dcode\//, "");
  return {
    id: `${shortName}-copy`,
    name: `${builtin.name} (Copy)`,
    description: builtin.description ?? "",
    body: builtin.body ?? "",
    enabled: true,
    scope: GLOBAL_SCOPE,
  };
}

/** Mirror of host-core's `slugify`, so the id shown matches the one stored. */
export function skillSlug(value: string): string {
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
  return slug.slice(0, 64).replace(/-+$/, "");
}

/** Returns an i18n key for the first problem, or null when the draft can save. */
export function skillDraftError(draft: SkillDraft): string | null {
  if (!draft.name.trim()) return "extensions.skills.errorName";
  if (!skillSlug(draft.name) && !draft.id) return "extensions.skills.errorSlug";
  if (!draft.description.trim()) return "extensions.skills.errorDescription";
  if (!draft.body.trim()) return "extensions.skills.errorBody";
  if (new TextEncoder().encode(draft.body).length > MAX_SKILL_BYTES) {
    return "extensions.skills.errorTooBig";
  }
  return null;
}
