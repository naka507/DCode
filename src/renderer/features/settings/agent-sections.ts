/**
 * Framework-free half of the agent settings sections.
 *
 * The tables and pure helpers of the agent settings sections, kept apart from
 * the presentational components. Each component lives in its own file
 * next door (`AgentInstructionsSection.vue`, `UpdatesRow.vue`,
 * `ImportSection.vue`, `SessionImportPanel.vue`, `ModelConfigImportPanel.vue`,
 * `SkillsScanImportPanel.vue`, `McpScanImportPanel.vue`).
 */
import type {
  ExternalMcpSourceKind,
  ExternalSkillSourceKind,
} from "../../lib/api";

/**
 * The visible host of a provider base URL.
 *
 * Used as the model-config row's second meta fragment. A value the URL parser
 * rejects (a bare host, a partial paste) is trimmed by hand rather than
 * dropped, so the row still says something.
 */
export function hostOf(baseUrl: string | null): string {
  if (!baseUrl) return "";
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").split("/")[0] || baseUrl;
  }
}

/**
 * Bucket scan candidates by their source, preserving first-seen order.
 *
 * The two agent-scan panels group by source only — unlike the session import
 * there is no per-candidate date to sort by, and the source list is short.
 */
export function groupBySource<C extends { source: string }>(
  candidates: C[],
): Array<{ id: string; items: C[] }> {
  const map = new Map<string, C[]>();
  for (const candidate of candidates) {
    const bucket = map.get(candidate.source);
    if (bucket) bucket.push(candidate);
    else map.set(candidate.source, [candidate]);
  }
  return Array.from(map.entries()).map(([id, items]) => ({ id, items }));
}

/** i18n key for each external skill source, with a fallback for new kinds. */
export const SKILL_SOURCE_KEY: Record<ExternalSkillSourceKind, string> = {
  "claude-user": "settings.importAgentScanSourceClaudeUser",
  "claude-project": "settings.importAgentScanSourceClaudeProject",
  "pi-user": "settings.importAgentScanSourcePiUser",
  "pi-project": "settings.importAgentScanSourcePiProject",
};

/** i18n key for each external MCP source, with a fallback for new kinds. */
export const MCP_SOURCE_KEY: Record<ExternalMcpSourceKind, string> = {
  "claude-desktop": "settings.importAgentScanSourceClaudeDesktop",
  "claude-code": "settings.importAgentScanSourceClaudeCode",
  "cursor-global": "settings.importAgentScanSourceCursorGlobal",
  "cursor-project": "settings.importAgentScanSourceCursorProject",
  codex: "settings.importAgentScanSourceCodex",
  opencode: "settings.importAgentScanSourceOpenCode",
  "chatgpt-desktop": "settings.importAgentScanSourceChatgpt",
};
