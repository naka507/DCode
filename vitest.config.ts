import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Runner for the `.test.ts` suites.
 *
 * Each of these sits beside its subject as a single project, so they live under
 * `tests/` alongside the `node --test` suites. Two things still need bridging:
 *
 *  1. `@dcode/<name>` specifiers are workspace packages that are mapped into
 *     `src/`. Keep this table in sync with `packageAliases` in
 *     electron.vite.config.ts, the `paths` block of tsconfig.json, and the
 *     mirror in tests/helpers/ts-import-hooks.mjs.
 *  2. The sources use bundler-style `.js` specifiers that only exist as `.ts`
 *     on disk. Vite resolves those natively, so no extra plugin is needed.
 *
 * Only `tests/**` is collected, and only `.test.ts`. `node --test` runs the
 * `.test.mjs` suites under the same directory, so the two runners never claim
 * the same file.
 */
const packageAliases = {
  "@dcode/shared/protocol": resolve(__dirname, "src/shared/protocol.ts"),
  "@dcode/shared/theme": resolve(__dirname, "src/shared/theme.ts"),
  "@dcode/shared": resolve(__dirname, "src/shared/index.ts"),
  "@dcode/i18n": resolve(__dirname, "src/i18n/index.ts"),
  "@dcode/engine": resolve(__dirname, "src/engine/index.ts"),
  "@dcode/host-runtime": resolve(__dirname, "src/engine/index.ts"),
  "@dcode/agent-runtime": resolve(__dirname, "src/agent/runtime/index.ts"),
  "@dcode/agent/runtime": resolve(__dirname, "src/agent/runtime/index.ts"),
  "@dcode/agent-host": resolve(__dirname, "src/agent/host/index.ts"),
  "@dcode/agent/host": resolve(__dirname, "src/agent/host/index.ts"),
  "@dcode/racp": resolve(__dirname, "src/racp/index.ts"),
  "@dcode/plugin-sdk": resolve(__dirname, "src/plugin/sdk/index.ts"),
  "@dcode/plugin/sdk": resolve(__dirname, "src/plugin/sdk/index.ts"),
  "@dcode/plugin-devkit": resolve(__dirname, "src/plugin/devkit/index.ts"),
  "@dcode/plugin/devkit": resolve(__dirname, "src/plugin/devkit/index.ts"),
};

export default defineConfig({
  resolve: { alias: packageAliases },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Two suites drive a real esbuild bundle and a real process fork; the
    // default 5s per-test timeout is not enough for either.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
