---
name: Electron Project Conventions
description: Electron application structure and conventions — main/renderer/preload split, IPC patterns, and packaging. Use when working on Electron app architecture (not automation; see the electron skill for CDP-based automation).
---

# Electron Project Conventions

Structural conventions for Electron desktop applications, as practiced in DCode. (For *automating* a running Electron app via CDP, see the `electron` skill.)

## Process Model

```
Renderer (Vue/React UI)
   ↓  ipcRenderer.invoke / on
Preload (context bridge)
   ↓  structuredClone boundary
Electron Main (Node.js)
   ↓  stdio / native modules
Native Host / Services
```

- **Renderer** is a web page. No Node APIs, no filesystem, no direct DB. All privileged operations go through IPC.
- **Preload** is the only bridge. It exposes a minimal, reviewed API via `contextBridge`. Never expose `ipcRenderer` itself or `require`.
- **Main** is a thin orchestrator. Business logic lives in services/modules, not in the `app.on('ready')` handler.

## IPC Patterns

- **Invoke/handle for request-response.** `ipcRenderer.invoke('channel', ...args)` ↔ `ipcMain.handle('channel', handler)`. Prefer this over `send`/`on` for anything that returns data.
- **Everything is `structuredClone`.** No functions, no class instances, no DOM nodes across the boundary. Vue `ref`/`reactive` are Proxies — unwrap to plain data before invoking.
- **Validate in main.** The renderer is untrusted input. Every handler validates params (types, ranges, paths) before acting.
- **Channel naming:** `domain:action` (e.g. `session:create`, `tools:execute`). Keep the list in one place so it stays reviewable.

## Preload Discipline

- Expose the smallest possible surface. Each method is a deliberate API decision.
- No logic in preload — it's a pass-through. Validation and policy live in main.
- Version the preload API. Renderer and preload ship together, but a stale renderer (after a partial update) must fail loudly, not silently.

## Packaging (electron-builder)

- **extraResources** for sidecar binaries and skill files — they're unpacked next to the app, resolved via `process.resourcesPath`.
- **ASAR** packaging: `__dirname` behaves differently. Use `app.getAppPath()` / `process.resourcesPath`, never relative paths from source.
- **Native modules** must be rebuilt for Electron's Node version (`electron-rebuild`), not the system Node.
- **Code signing** (macOS/Windows) is required for auto-update and to avoid OS warnings. Unsigned builds are dev-only.

## Common Gotchas

- **Dev vs packaged paths differ.** Code that works with `process.cwd()` in dev breaks in the packaged app. Always resolve via the Electron path APIs.
- **Single instance lock.** Use `app.requestSingleInstanceLock()` — a second launch should focus the existing window, not start a new backend.
- **Background throttling.** Hidden renderer windows get throttled timers. Critical intervals (heartbeats, watchers) belong in main, not the renderer.
- **DevTools in production.** Never ship with `openDevTools()` reachable. Gate it behind a debug flag.
