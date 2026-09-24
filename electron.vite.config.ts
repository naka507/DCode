import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

// The workspace packages were folded into `src/` when this repo became a single
// project, so every `@dcode/<name>` specifier resolves to a local folder.
// One alias table keeps ~300 existing import specifiers untouched instead of
// rewriting them all to relative paths.
//
// Subpath entries must precede the bare entry: Vite alias matching is
// prefix-based, so "@dcode/shared" would otherwise swallow
// "@dcode/shared/protocol" and rewrite it to ".../index.ts/protocol".
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

// Dev needs 'unsafe-eval' for vite HMR tooling; production must not ship it.
function tightenCsp(): Plugin {
  return {
    name: "dcode-tighten-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(" 'unsafe-eval'", "").replace(/connect-src [^;]*;/, "connect-src 'self';");
    },
  };
}

// Electron ships a Chromium that always supports woff2, but KaTeX's stylesheet
// lists woff and truetype fallbacks for every face. Dropping those src entries
// lets Rollup tree-shake the assets it would otherwise emit but never serve.
function dropLegacyFontFallbacks(): Plugin {
  return {
    name: "dcode-drop-legacy-font-fallbacks",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (!/\.css(?:\?.*)?$/.test(id)) return null;
      const stripped = code.replace(/,\s*url\([^)]+\)\s*format\("(?:woff|truetype)"\)/g, "");
      return stripped === code ? null : { code: stripped, map: null };
    },
  };
}

export default defineConfig({
  main: {
    // `ws` loads its optional native accelerators inside require + try/catch and
    // falls back to its JavaScript implementation when they are absent. A bundle
    // cannot fail a require, and Vite turns the unresolved optional peer into a
    // module-level throw that kills the whole Main bundle, so state the
    // documented "no native accelerator" input at build time instead.
    define: {
      "process.env.WS_NO_BUFFER_UTIL": '"1"',
      "process.env.WS_NO_UTF_8_VALIDATE": '"1"',
    },
    resolve: { alias: packageAliases },
    build: {
      rollupOptions: {
        // Only runtime modules that must resolve from the packaged node_modules
        // stay external. jiti is loaded lazily by the sidecar's trusted-extension
        // loader; its transpiled dist breaks the main bundle's esbuild transform.
        external: ["electron-updater", "jiti", "jiti/static"],
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          // Forked per plugin by PluginRuntime; must stay a standalone entry so
          // utilityProcess can point at a real file.
          "plugin-host-process": resolve(__dirname, "src/main/plugin-host-process.ts"),
        },
      },
    },
  },
  preload: {
    resolve: { alias: packageAliases },
    // The preload must be a fully bundled CJS file so it can run in a sandboxed
    // renderer without Node module resolution.
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
          "plugin-panel": resolve(__dirname, "src/preload/plugin-panel.ts"),
        },
        output: {
          format: "cjs",
          // Main window preload stays .cjs; plugin panels use .js as referenced
          // by the panel host.
          entryFileNames: (chunk) => (chunk.name === "plugin-panel" ? "[name].js" : "[name].cjs"),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      // electron-vite's renderer preset hard-defaults minify to false, unlike
      // plain Vite.
      minify: "esbuild",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
    plugins: [vue(), tailwindcss(), tightenCsp(), dropLegacyFontFallbacks()],
    resolve: {
      alias: {
        ...packageAliases,
        "@renderer": resolve(__dirname, "src/renderer"),
      },
    },
  },
});

