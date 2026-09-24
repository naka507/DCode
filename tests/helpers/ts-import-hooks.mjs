/**
 * Module hooks that let `node --test` import main-process TypeScript directly.
 *
 * Two things need bridging between the bundler and Node's ESM resolver:
 *
 *  1. The sources use bundler-style relative imports: extensionless specifiers
 *     (`./plugin-mcp`) and `.js` specifiers that only exist as `.ts` on disk.
 *     ESM rejects both, so the exact specifier is tried first and the
 *     TypeScript sibling second — a real `.js` or `.mjs` file still wins, and
 *     nothing that already resolved changes.
 *
 *  2. `@dcode/<name>` specifiers are workspace packages that are mapped
 *     into `src/`. Vite and tsconfig both alias them; `node --test` has no
 *     alias table, so the same mapping is mirrored here. Keep this table in
 *     sync with `packageAliases` in electron.vite.config.ts and the `paths`
 *     block of tsconfig.json. Subpath entries come first because matching is
 *     prefix-based.
 *
 * Register with:
 *   register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Repo root as a directory URL, e.g. file:///E:/Code/dcode/ */
const repoRootUrl = new URL("../../", import.meta.url);

const packageAliases = [
  ["@dcode/shared/protocol", "src/shared/protocol.ts"],
  ["@dcode/shared/theme", "src/shared/theme.ts"],
  ["@dcode/shared", "src/shared/index.ts"],
  ["@dcode/i18n", "src/i18n/index.ts"],
  ["@dcode/engine", "src/engine/index.ts"],
  ["@dcode/host-runtime", "src/engine/index.ts"],
  ["@dcode/agent-runtime", "src/agent/runtime/index.ts"],
  ["@dcode/agent/runtime", "src/agent/runtime/index.ts"],
  ["@dcode/agent-host", "src/agent/host/index.ts"],
  ["@dcode/agent/host", "src/agent/host/index.ts"],
  ["@dcode/racp", "src/racp/index.ts"],
  ["@dcode/plugin-sdk", "src/plugin/sdk/index.ts"],
  ["@dcode/plugin/sdk", "src/plugin/sdk/index.ts"],
  ["@dcode/plugin-devkit", "src/plugin/devkit/index.ts"],
  ["@dcode/plugin/devkit", "src/plugin/devkit/index.ts"],
];

function aliasTarget(specifier) {
  for (const [prefix, relativeTarget] of packageAliases) {
    if (specifier === prefix) return new URL(relativeTarget, repoRootUrl).href;
    if (!specifier.startsWith(`${prefix}/`)) continue;
    // Subpath import of a mapped package: try the literal path, then `.ts`.
    const rest = specifier.slice(prefix.length + 1);
    const baseDir = relativeTarget.replace(/\/[^/]+$/, "");
    const direct = new URL(`${baseDir}/${rest}`, repoRootUrl);
    if (existsSync(fileURLToPath(direct))) return direct.href;
    const asTypeScript = new URL(`${direct.href}.ts`);
    if (existsSync(fileURLToPath(asTypeScript))) return asTypeScript.href;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@dcode/")) {
    const target = aliasTarget(specifier);
    if (target !== null) return next(target, context);
  }
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return next(specifier, context);
  }
  try {
    return await next(specifier, context);
  } catch (error) {
    const typescript = specifier.endsWith(".js")
      ? `${specifier.slice(0, -".js".length)}.ts`
      : /\.[a-z]+$/i.test(specifier)
        ? null
        : `${specifier}.ts`;
    if (typescript === null) throw error;
    return next(typescript, context);
  }
}
