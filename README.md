# DCode

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Release Line](https://img.shields.io/badge/Release_Line-1.0.x-green.svg)](package.json)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.19-brightgreen.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#)

[English](README.md) | [简体中文](README.zh-CN.md)

**DCode** is an open-source, extensible desktop workspace designed for autonomous and interactive AI coding agents. It provides a full-featured desktop environment combining an Electron shell, a Vue 3 reactive UI, a dedicated Node.js agent runtime, and a high-performance native host core.

---

## Status

- **Current release line:** `1.0.x` (Active stable release: `1.0.1`)
- **License:** Apache License 2.0

---

## System Architecture

DCode adheres to a strictly defined multi-process architecture with clean ownership boundaries:

```
┌────────────────────────────────────────────────────────┐
│                   Renderer (Vue 3)                     │
│    Three-column UI, Pinia shallowRef State Container   │
└───────────────────────────┬────────────────────────────┘
                            │ Preload IPC Bridge
┌───────────────────────────▼────────────────────────────┐
│                  Electron Main Process                 │
│      Thin Orchestrator, Window & Lifecycle Manager     │
└─────────────┬───────────────────────────┬──────────────┘
              │                           │
┌─────────────▼─────────────┐   ┌─────────▼──────────────┐
│     Native Host Core      │   │  Agent Runtime Sidecar │
│ SQLite DB, Tools, System  │   │ pi-ai / pi-agent-core  │
└───────────────────────────┘   └────────────────────────┘
```

- **Renderer (`src/renderer/`)**: Built with Vue 3, Pinia (utilizing `shallowRef` to avoid IPC serialization overhead), and a 28-partial unified stylesheet. Provides responsive 3-column layout, markdown syntax highlighting with Shiki, and diagram rendering with Mermaid.
- **Electron Main (`src/main/`)**: Serves as a thin orchestrator managing application bootstrap, window lifecycles, IPC routing, and plugin runtimes.
- **Agent Runtime (`src/agent/runtime/`)**: Node.js sidecar wrapping `pi-ai` and `pi-agent-core` to handle model communication, turn execution, streaming responses, and subagent lifecycles.
- **Native Host Core**: Provides authoritative SQLite persistence (`pi.sqlite`), file system operations, process supervision, and high-performance native tools.

---

## Key Features

- **Multi-Agent Orchestration & Subagents**: Dispatch subtasks concurrently or sequentially, stream subagent execution results in real time, and supervise task progression.
- **Rich Native & System Tools**: Built-in terminal command execution (PowerShell / Bash), precision file editing via `hashline`, structured file management, and browser automation via `pi.browser`.
- **Multi-Provider Model Hub**: Seamless integration with Anthropic Claude, OpenAI, DeepSeek, Ollama, and arbitrary OpenAI-compatible gateways, enriched automatically with the `models.dev` catalog.
- **Plan Mode & Review UI**: Plan generation, step-by-step review, checkpoint snapshots, and session rollback support.
- **Plugin DevKit & Extensibility**: First-class plugin SDK and CLI (`pi-plugin`) supporting custom webview panels, tool contributions, commands, and skills.
- **Session & Transcript Management**: Fast full-text transcript search, disclosure anchors, and unified session histories.
- **Cross-Platform & Bilingual**: Windows, macOS (with native vibrancy / translucent glass), and Linux support, with built-in English and Simplified Chinese (`zh-CN`) localization.

---

## Project Structure

```text
DCode/
├── build/                 # Application icons, packaging metadata, and build assets
├── docs/                  # Architecture documentation and media assets
│   └── ARCHITECTURE.md    # In-depth architectural records and contracts
├── resources/             # Built-in skills, bundled plugins, and models.dev catalog
├── scripts/               # Automation, E2E harnesses, and quality gate scripts
│   └── README.md          # Guide to internal developer scripts
├── src/
│   ├── agent/                 # Agent host & runtime modules
│   │   ├── host/              # Headless agent host (admission, queues, approvals)
│   │   └── runtime/           # pi sidecar wrapper (bundled via esbuild)
│   ├── engine/                # Execution engine (process management, turn supervision, workspace diffs)
│   ├── i18n/                  # Localization catalogs (en, zh-CN)
│   ├── main/                  # Electron main process and IPC endpoints
│   ├── plugin/                # Plugin ecosystem
│   │   ├── devkit/            # pi-plugin developer CLI
│   │   └── sdk/               # Plugin SDK types and manifest validators
│   ├── preload/               # Electron preload bridge scripts
│   ├── racp/              # RACP-WS protocol and device pairing
│   ├── renderer/          # Vue 3 UI application
│   └── shared/            # Cross-boundary schemas, protocols, and contracts
└── tests/                 # Node test runner (`node --test`) and Vitest test suites
```

---

## Getting Started

### Prerequisites

- **Node.js**: `≥ 22.19.0`
- **npm**: Package manager (uses `package-lock.json`)
- **Native Host Binary**: A pre-compiled `DCore` executable under `bin/` (bundled automatically in release packages, or provided in local development environments)
- **Python 3**: Optional, required only for regenerating brand assets and icons

### Installation

1. Clone the DCode repository:

```bash
git clone https://github.com/naka507/DCode.git
```

2. Install dependencies:

```bash
cd DCode
npm install
```

3. Build the agent runtime sidecar:

```bash
npm run build:sidecar
```

4. Ensure the native host binary (`DCore` / `DCore.exe`) is present in `bin/` (or configured via the `DCODE_HOST_BIN` environment variable):

```bash
# Verify bin directory
ls bin/
```

### Development

Start the Electron development environment with Hot Module Replacement (HMR):

```bash
npm run dev
```

---

## Testing & Quality Gates

Run the verification suites before committing:

```bash
# Run primary Node.js test suites
npm test

# Run Vitest unit tests
npm run test:unit

# Run all test suites
npm run test:all

# Type check Vue and TypeScript files
npm run typecheck

# Lint token usage and stylesheets
npm run lint

# Architecture constraint validation
node scripts/check-architecture.mjs

# Agent policy sync validation
node scripts/check-agent-policy-sync.mjs
```

---

## Packaging & Distribution

Package DCode for target operating systems:

```bash
# Compile and create an unpacked executable directory
npm run pack

# Package for current platform
npm run dist

# Target-specific platform builds
npm run dist:win     # Windows (NSIS installer & portable)
npm run dist:mac     # macOS (DMG & zip, universal/arm64)
npm run dist:linux   # Linux (AppImage & ASAR)
```

---

## License

This project is licensed under the **Apache License, Version 2.0**. See the [LICENSE](LICENSE) file for the full text.
