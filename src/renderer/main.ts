/**
 * Renderer entry point (Vue 3).
 *
 * Mirrors the boot side effects the shell depends on before first paint:
 *   1. `data-surface` tells the shell which surface this window is
 *      (`plugin-launcher` gets its own root component).
 *   2. `data-theme` / `data-platform` drive window-chrome layout; both must be
 *      set before the first paint so the window does not flash.
 *   3. The macOS traffic-light reserve comes from the same shared constant the
 *      main process positions the native views with.
 *   4. i18n is initialised before mount, then kept in step with persisted
 *      settings.
 */
import { createApp } from "vue";
import { catalogs, resolveLocale } from "@dcode/i18n";
import { MAC_TRAFFIC_LIGHT_EDGE_DIP } from "@dcode/shared";
import App from "./App.vue";
import PluginLauncher from "./components/PluginLauncher.vue";
import { i18n } from "./i18n";
import { installScrollbarReveal } from "./lib/scrollbar-reveal";
import { resolveOsLocale } from "./lib/app-language";
import { initializeAppStore } from "./stores/app-store";
import { rendererPinia } from "./stores/pinia";
import "./styles/globals.css";

const rendererSurface = new URLSearchParams(window.location.search).get("surface");
if (rendererSurface) document.documentElement.dataset.surface = rendererSurface;
document.documentElement.dataset.theme = "dark";
document.documentElement.dataset.platform = window.dcode?.platform ?? "darwin";

if (document.documentElement.dataset.platform === "darwin") {
  document.documentElement.style.setProperty(
    "--ds-traffic-light-edge",
    `${MAC_TRAFFIC_LIGHT_EDGE_DIP}px`,
  );
}

installScrollbarReveal(document);

// Importing ./i18n installs every shipped catalog into the instance (translated
// from the i18next dialect the catalogs are written in). The catalogs themselves
// are the single source of truth, so the dialect and the compiled form cannot
// drift; the boot code here only has to pick the starting locale.
i18n.global.locale.value = resolveLocale(resolveOsLocale());
document.documentElement.lang = i18n.global.locale.value;

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("root element missing");
}

try {
  const app = createApp(rendererSurface === "plugin-launcher" ? PluginLauncher : App);
  app.use(rendererPinia);
  app.use(i18n);
  // The composed chat store belongs to the main window; the launcher surface is
  // a standalone picker that never reads it. Building it here — after
  // `app.use(rendererPinia)` — is what lets Pinia plugins reach it, and gives
  // the first paint a state object instead of the pre-commit placeholder.
  if (rendererSurface !== "plugin-launcher") initializeAppStore();
  app.mount(rootEl);
} catch (error) {
  // Rendered with DOM nodes, not markup: the error text is untrusted and must
  // never be interpreted as HTML.
  const crashCatalog = catalogs[i18n.global.locale.value as keyof typeof catalogs] ?? catalogs.en;
  const panel = document.createElement("div");
  panel.style.cssText =
    "padding:24px;font:14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#181818;color:#fff;height:100%";
  const heading = document.createElement("h1");
  heading.style.cssText = "margin:0 0 8px;font-size:16px";
  heading.textContent = crashCatalog.app.uiCrashed;
  const detail = document.createElement("pre");
  detail.style.cssText = "white-space:pre-wrap;color:#fca5a5";
  detail.textContent = String(error);
  panel.append(heading, detail);
  rootEl.replaceChildren(panel);
}
