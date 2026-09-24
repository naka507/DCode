import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillFrontmatter } from "@dcode/plugin-sdk";
import type { PluginSkillDef } from "@dcode/agent-runtime";

const currentDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : typeof import.meta?.url === "string"
      ? dirname(fileURLToPath(import.meta.url))
      : process.cwd();

/**
 * Skills dcode ships itself.
 *
 * These ride the same catalog-plus-`Skill`-tool path as plugin-contributed
 * skills (D174), so a first-party skill and a third-party one are
 * indistinguishable to the model — but they need no permission grant, because
 * the host is not a plugin.
 */

/** Bundled skill teaching the plugin-development loop. */
export const PLUGIN_DEV_SKILL_FILE = "plugin-development.md";
export const PLUGIN_DEV_SKILL_ID = "dcode/plugin-development";

/** electron-builder copies `resources/skills` to `<resources>/skills`. */
function resolveBuiltinSkillPath(fileName: string): string | null {
  const candidates = [
    join(process.resourcesPath || "", "skills", fileName),
    join(currentDir, "../../resources/skills", fileName),
    join(currentDir, "../../../resources/skills", fileName),
    join(process.cwd(), "resources/skills", fileName),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * True when this workspace looks like plugin development: a plugin manifest at
 * the root, or a plugin already loaded from inside it.
 *
 * The gate matters. A plugin-authoring primer in every session would burn
 * context for the vast majority of sessions that never write a plugin; the
 * three plugin tools stay registered regardless, and calling one puts a
 * manifest in the workspace, which activates the skill on the next prompt.
 */
export function isPluginWorkspace(
  workspacePath: string | null | undefined,
  pluginPaths: string[] = [],
): boolean {
  if (!workspacePath) return false;
  const manifestPath = join(workspacePath, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (
        manifest &&
        typeof manifest === "object" &&
        typeof manifest.schemaVersion === "number" &&
        typeof manifest.main === "string"
      ) {
        return true;
      }
    } catch {
      // An unparseable manifest is not evidence either way.
    }
  }
  const prefix = workspacePath.endsWith("/") ? workspacePath : `${workspacePath}/`;
  return pluginPaths.some((path) => path === workspacePath || path.startsWith(prefix));
}

/** Front matter carries the skill's title and applicability line. */
function readBuiltinSkill(fileName: string): string | null {
  const path = resolveBuiltinSkillPath(fileName);
  if (!path) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export type BuiltinSkillInput = {
  workspacePath?: string | null;
  /** Directories of currently loaded plugins, used to detect a dev workspace. */
  pluginPaths?: string[];
};

export type BuiltinSkillManifestItem = {
  id: string;
  file: string;
  pluginWorkspaceOnly?: boolean;
};

export const BUILTIN_SKILLS_MANIFEST: readonly BuiltinSkillManifestItem[] = [
  {
    id: PLUGIN_DEV_SKILL_ID,
    file: PLUGIN_DEV_SKILL_FILE,
    pluginWorkspaceOnly: true,
  },
  {
    id: "dcode/react-best-practices",
    file: "react-best-practices.md",
  },
  {
    id: "dcode/vue-best-practices",
    file: "vue-best-practices.md",
  },
  {
    id: "dcode/agent-browser",
    file: "agent-browser.md",
  },
  {
    id: "dcode/dogfood",
    file: "dogfood.md",
  },
  {
    id: "dcode/electron",
    file: "electron.md",
  },
];

/**
 * Catalog entries for the built-in skills that apply to the given session, read
 * fresh so a packaged update takes effect without a restart.
 */
export function builtinSkills(input: BuiltinSkillInput): PluginSkillDef[] {
  const isPluginDev = isPluginWorkspace(input.workspacePath, input.pluginPaths);
  const out: PluginSkillDef[] = [];
  for (const item of BUILTIN_SKILLS_MANIFEST) {
    if (item.pluginWorkspaceOnly && !isPluginDev) {
      continue;
    }
    const raw = readBuiltinSkill(item.file);
    if (!raw?.trim()) continue;
    const parsed = parseSkillFrontmatter(raw);
    if (!parsed.body) continue;
    out.push({
      id: item.id,
      name: parsed.name ?? item.id,
      description: parsed.description,
    });
  }
  return out;
}

/**
 * Load a built-in skill body for the `Skill` tool. Returns null for any id the
 * host does not ship, which is the caller's cue to try the plugin registry.
 */
export function loadBuiltinSkillBody(
  id: string,
): { id: string; name: string; body: string } | null {
  const targetId = id.startsWith("dcode/") ? id : `dcode/${id}`;
  const item = BUILTIN_SKILLS_MANIFEST.find(
    (entry) => entry.id === id || entry.id === targetId,
  );
  if (!item) return null;
  const raw = readBuiltinSkill(item.file);
  if (!raw?.trim()) return null;
  const parsed = parseSkillFrontmatter(raw);
  if (!parsed.body) return null;
  return {
    id: item.id,
    name: parsed.name ?? item.id,
    body: parsed.body,
  };
}

export type BuiltinSkillInfo = {
  id: string;
  name: string;
  description: string;
  body: string;
  pluginWorkspaceOnly?: boolean;
};

/**
 * List all shipped built-in skills for the settings UI.
 */
export function listAllBuiltinSkills(): BuiltinSkillInfo[] {
  const out: BuiltinSkillInfo[] = [];
  for (const item of BUILTIN_SKILLS_MANIFEST) {
    const raw = readBuiltinSkill(item.file);
    if (!raw?.trim()) continue;
    const parsed = parseSkillFrontmatter(raw);
    out.push({
      id: item.id,
      name: parsed.name ?? item.id,
      description: parsed.description ?? "",
      body: parsed.body ?? "",
      pluginWorkspaceOnly: item.pluginWorkspaceOnly,
    });
  }
  return out;
}
