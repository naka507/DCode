/**
 * Framework-free half of the MCP server editor.
 *
 * Holds the draft model and its conversions, kept apart from the presentational
 * sheet. The component itself is `components/extensions/McpEditorSheet.vue`,
 * which re-exports every name below from its plain `<script>` block so
 * `AgentMcpPage` keeps importing `draftFromRecord`, `draftToInput`,
 * `emptyMcpDraft`, `type McpDraft` and `McpEditorSheet` from one specifier.
 *
 * The name does not repeat the component's, following `skill-editor.ts` beside
 * `SkillEditorSheet.vue`.
 */
import {
  GLOBAL_SCOPE,
  resolveScope,
  type ActivationScope,
  type AgentCapabilityLevel,
  type McpPreset,
  type McpServerInput,
  type McpServerRecord,
  type McpTransport,
} from "@dcode/shared";
import { recordToPairs, pairsToRecord, type KeyValuePair } from "./key-value-rows";

export type McpDraft = {
  id: string;
  label: string;
  description: string;
  transport: McpTransport;
  command: string;
  args: string;
  env: KeyValuePair[];
  url: string;
  headers: KeyValuePair[];
  enabled: boolean;
  scope: ActivationScope;
};

export function emptyMcpDraft(): McpDraft {
  return {
    id: "",
    label: "",
    description: "",
    transport: "stdio",
    command: "",
    args: "",
    env: [],
    url: "",
    headers: [],
    enabled: true,
    scope: GLOBAL_SCOPE,
  };
}

export function draftFromRecord(record: McpServerRecord): McpDraft {
  return {
    id: record.id,
    label: record.label ?? "",
    description: record.description ?? "",
    transport: record.transport,
    command: record.command ?? "",
    args: (record.args ?? []).join(" "),
    env: recordToPairs(record.env),
    url: record.url ?? "",
    headers: recordToPairs(record.headers),
    enabled: record.enabled,
    scope: resolveScope(record.scope),
  };
}

export function draftFromPreset(preset: McpPreset, scope: ActivationScope = GLOBAL_SCOPE): McpDraft {
  const s = preset.server;
  return {
    id: s.id,
    label: s.label ?? preset.name,
    description: s.description ?? preset.description,
    transport: s.transport,
    command: s.command ?? "",
    args: (s.args ?? []).join(" "),
    env: recordToPairs(s.env),
    url: s.url ?? "",
    headers: recordToPairs(s.headers),
    enabled: s.enabled !== false,
    scope,
  };
}

/**
 * Split a command line into arguments, honouring quotes.
 *
 * The field takes one line because that is how every MCP README prints the
 * command, and asking the user to re-key `npx -y pkg` as three rows would be
 * hostile. Quoted segments survive so a path with a space still arrives as one
 * argument.
 */
export function splitArgs(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const char of value) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

/** Slug host-core will accept: starts with a letter, `[A-Za-z0-9_-]` after. */
export function mcpIdFromLabel(label: string): string {
  const cleaned = label
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);
  return /^[a-z]/.test(cleaned) ? cleaned : "";
}

export function draftToInput(
  draft: McpDraft,
  context?: { level?: AgentCapabilityLevel; projectPath?: string },
): McpServerInput {
  const base = {
    id: draft.id.trim(),
    ...(context?.level ? { level: context.level } : {}),
    ...(context?.projectPath ? { projectPath: context.projectPath } : {}),
    label: draft.label.trim() || draft.id.trim(),
    description: draft.description.trim() || undefined,
    enabled: draft.enabled,
    scope: draft.scope,
  };
  if (draft.transport === "http") {
    return {
      ...base,
      transport: "http",
      url: draft.url.trim(),
      headers: pairsToRecord(draft.headers),
    };
  }
  return {
    ...base,
    transport: "stdio",
    command: draft.command.trim(),
    args: splitArgs(draft.args),
    env: pairsToRecord(draft.env),
  };
}

/** Client-side mirror of host-core's rules, so the form can explain itself. */
export function mcpDraftError(draft: McpDraft): string | null {
  if (!draft.id.trim()) return "extensions.mcp.errorId";
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(draft.id.trim())) return "extensions.mcp.errorIdShape";
  if (draft.transport === "stdio") {
    if (!draft.command.trim()) return "extensions.mcp.errorCommand";
    if (draft.command.includes("..")) return "extensions.mcp.errorCommandDots";
    return null;
  }
  const url = draft.url.trim();
  if (!url) return "extensions.mcp.errorUrl";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "extensions.mcp.errorUrlShape";
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") return null;
  return "extensions.mcp.errorUrlScheme";
}
