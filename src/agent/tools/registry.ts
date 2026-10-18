/**
 * ADR-002 Phase A: unified Tool contract (read-only modeling).
 *
 * This module defines the single Tool contract every tool source
 * (DCode builtins, DCore native tools, MCP servers, plugins) converges on,
 * plus the permission declarations for the statically-known tools.
 *
 * Phase A is deliberately read-only: nothing here changes runtime behavior.
 * Its job is to make the implicit permission knowledge scattered across
 * `runtime.ts` (`PATH_MUTATING_TOOLS`, `CHAT_CORE_TOOL_NAMES`,
 * `AGENT_CORE_TOOL_NAMES`, per-tool risk comments) explicit and CI-checked,
 * so a tool added without a permission declaration fails the build instead
 * of silently inheriting whatever the call site assumed.
 *
 * Later phases:
 * - Phase B: DCore serves `tools.describe`; the sidecar builds DCore tool
 *   entries from that manifest instead of hardcoded descriptions.
 * - Phase C: plugin manifest `tools[]` declarations + MCP risk overrides;
 *   the hardcoded name sets in `runtime.ts` are derived from this registry.
 */

/** Where a tool implementation comes from. */
export type ToolSource = "dcore" | "mcp" | "plugin" | "builtin";

/** What a tool is allowed to touch. Drives approval and concurrency rules. */
export type ToolPermissionScope = "read" | "write" | "execute" | "network";

/**
 * Blast radius of a call. `high` must go through user approval;
 * see the approval flow in `runtime.ts`.
 */
export type ToolPermissionRisk = "low" | "medium" | "high";

/** Filesystem reach of a path-taking tool. */
export type ToolPathScope = "project" | "any";

export interface ToolPermission {
  scope: ToolPermissionScope;
  risk: ToolPermissionRisk;
  /** Only meaningful for tools that take a `path` argument. */
  paths?: ToolPathScope;
}

export interface ToolDefinition {
  /** Globally unique, e.g. "Read" or (Phase C) "mcp.github.create_issue". */
  name: string;
  source: ToolSource;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
  permission: ToolPermission;
  /** True when repeating the call with identical args is a no-op. */
  idempotent: boolean;
  /** True when the tool can preview its effect without applying it. */
  supportsDryRun: boolean;
}

/**
 * Builtin tool names per mode, extracted from
 * `DesktopAgentRuntime.buildToolDefinitions` so the registry module — not a
 * 7000-line runtime file — owns the list. The runtime imports these; the
 * order and contents are unchanged.
 */
export const AGENT_MODE_BUILTIN_TOOLS = [
  "Read",
  "Bash",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "BrowserPreview",
  "PluginCheck",
  "PluginScaffold",
  "PluginPack",
] as const;

export const CONTRACT_MODE_BUILTIN_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "BrowserPreview",
  "Bash",
] as const;

/**
 * Permission declarations for every statically-known tool. This is the
 * table CI validates against: adding a tool to the builtin lists above
 * without adding a row here fails `tests/agent/tool-registry.test.ts`.
 *
 * Risk levels are initial calibrations, reviewed with the user — not
 * derived truths. When in doubt a tool is rated up, never down.
 */
export const TOOL_PERMISSION_DECLARATIONS: Record<string, ToolPermission> = {
  // -- Filesystem reads: no side effects -------------------------------
  Read: { scope: "read", risk: "low", paths: "project" },
  Glob: { scope: "read", risk: "low", paths: "project" },
  Grep: { scope: "read", risk: "low", paths: "project" },
  BrowserPreview: { scope: "read", risk: "low", paths: "project" },
  // -- Filesystem writes: the old PATH_MUTATING_TOOLS set ---------------
  Write: { scope: "write", risk: "high", paths: "project" },
  Edit: { scope: "write", risk: "high", paths: "project" },
  // -- Execution ---------------------------------------------------------
  Bash: { scope: "execute", risk: "high", paths: "any" },
  // -- Plugin lifecycle: operations, not direct path mutations ------------
  // (scope "execute": the PathMutex set derived from scope "write" stays
  // exactly {"Write", "Edit"} — see isPathMutatingTool).
  PluginCheck: { scope: "read", risk: "low", paths: "project" },
  PluginScaffold: { scope: "execute", risk: "medium", paths: "project" },
  PluginPack: { scope: "execute", risk: "medium", paths: "project" },
  // -- User interaction --------------------------------------------------
  asktool: { scope: "read", risk: "low" },
  Skill: { scope: "read", risk: "low" },
  // -- Contract mode transitions (D198) ----------------------------------
  EnterPlanMode: { scope: "execute", risk: "medium" },
  EnterGoalMode: { scope: "execute", risk: "medium" },
  SubmitPlan: { scope: "execute", risk: "high" },
  SubmitGoal: { scope: "execute", risk: "high" },
  // -- Delegation lifecycle (ADR 0089) -----------------------------------
  Task: { scope: "execute", risk: "medium" },
  TaskWait: { scope: "read", risk: "low" },
  TaskList: { scope: "read", risk: "low" },
  TaskStop: { scope: "execute", risk: "medium" },
  // -- Context management -------------------------------------------------
  new_context: { scope: "execute", risk: "medium" },
};

const TOOL_IDEMPOTENT: Record<string, boolean> = {
  Read: true,
  Glob: true,
  Grep: true,
  BrowserPreview: true,
  Write: true, // same path + content => same file state
  Edit: false, // tag-grounded ops are stateful across calls
  Bash: false,
  PluginCheck: true,
  PluginScaffold: false,
  PluginPack: true,
  asktool: true,
  Skill: true,
  EnterPlanMode: true,
  EnterGoalMode: true,
  SubmitPlan: false,
  SubmitGoal: false,
  Task: false,
  TaskWait: true,
  TaskList: true,
  TaskStop: true,
  new_context: false,
};

const TOOL_SUPPORTS_DRY_RUN: Record<string, boolean> = {
  Read: true,
  Glob: true,
  Grep: true,
  BrowserPreview: true,
  Write: false,
  Edit: false,
  Bash: false,
  PluginCheck: true,
  PluginScaffold: false,
  PluginPack: false,
  asktool: true,
  Skill: true,
  EnterPlanMode: false,
  EnterGoalMode: false,
  SubmitPlan: false,
  SubmitGoal: false,
  Task: false,
  TaskWait: true,
  TaskList: true,
  TaskStop: false,
  new_context: false,
};

export class MissingToolPermissionError extends Error {
  readonly toolName: string;
  constructor(toolName: string) {
    super(
      `Tool "${toolName}" has no permission declaration in TOOL_PERMISSION_DECLARATIONS. ` +
        `Add one (ADR-002) before the tool can enter the registry.`,
    );
    this.name = "MissingToolPermissionError";
    this.toolName = toolName;
  }
}

export function getToolPermission(name: string): ToolPermission {
  const permission = TOOL_PERMISSION_DECLARATIONS[name];
  if (!permission) throw new MissingToolPermissionError(name);
  return permission;
}

/**
 * Convert a tool into contract form. The permission, idempotency and
 * dry-run flags come from the declaration tables; a tool without a
 * declaration throws instead of silently inheriting a default.
 */
export function toToolContract(input: {
  name: string;
  source: ToolSource;
  description: string;
  inputSchema: Record<string, unknown>;
}): ToolDefinition {
  return {
    name: input.name,
    source: input.source,
    description: input.description,
    inputSchema: input.inputSchema,
    permission: getToolPermission(input.name),
    idempotent: TOOL_IDEMPOTENT[input.name] ?? false,
    supportsDryRun: TOOL_SUPPORTS_DRY_RUN[input.name] ?? false,
  };
}

/**
 * Return the names in `names` that have no permission declaration.
 * Empty means the registry covers everything the caller can produce —
 * the CI assertion is `validateToolDeclarations(...)` returning `[]`.
 */
export function validateToolDeclarations(names: Iterable<string>): string[] {
  const missing: string[] = [];
  for (const name of names) {
    if (!TOOL_PERMISSION_DECLARATIONS[name]) missing.push(name);
  }
  return missing;
}

/**
 * Derive the old `PATH_MUTATING_TOOLS` set from declarations.
 * Phase C will rewire `runtime.ts` to this; Phase A only proves the
 * derivation matches (see the CI test).
 */
export function isPathMutatingTool(name: string): boolean {
  return TOOL_PERMISSION_DECLARATIONS[name]?.scope === "write";
}
