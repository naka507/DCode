# DCode

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Release Line](https://img.shields.io/badge/Release_Line-1.0.x-green.svg)](package.json)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.19-brightgreen.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#)

[English](README.md) | [简体中文](README.zh-CN.md)

**DCode** is an open-source, extensible desktop workspace designed for autonomous and interactive AI coding agents. It provides a full-featured desktop environment combining an Electron shell, a Vue 3 reactive UI, a dedicated Node.js agent runtime, and a high-performance native host core.

---

## Status

- **Current release line:** `1.0.x` (Active stable release: `1.0.4`)
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
- **Built-in Work Panel Plugins**: Clean, standardized single-word plugin architecture (`browser`, `files`, `terminal`, `documents`):
  - **`terminal`**: Interactive shell runner with host platform auto-detection (PowerShell/CMD on Windows, Bash/Zsh on macOS/Linux), quick action pills, command history navigation, and direct agent tool execution.
  - **`documents`**: Rich document reader featuring Markdown reading metrics, interactive hierarchical Table of Contents (TOC) with anchor navigation, preview/raw Markdown toggle, and embedded PDF document viewer.
  - **`browser`**: Headless or interactive web browsing with screenshot and DOM automation.
  - **`files`**: Tree-based file and directory manager with inline preview.
- **Curated MCP Preset Catalog & Cross-Platform Sync**: 9 curated open-source MCP presets (Context7, GitHub, Memory, Fetch, SQLite, Postgres, Filesystem, Puppeteer, Docker) with UI quick-fill chips in the MCP editor. Transparently translates file paths, command names (`npx.cmd` to `npx`), and environment variables during SSH remote host synchronization.
- **Zero-Overhead Engineering Skills Catalog**: Bundled engineering skills (`dcode/react-best-practices`, `dcode/agent-browser`, `dcode/dogfood`, `dcode/electron`) loaded on-demand via the agent `Skill` tool, keeping idle token consumption and memory usage at absolute zero.
- **Multi-Provider Model Hub**: Seamless integration with Anthropic Claude, OpenAI, DeepSeek, Ollama, and arbitrary OpenAI-compatible gateways, enriched automatically with the `models.dev` catalog.
- **Plan Mode Closed-Loop & Capsule Popover**: Renders a floating plan status capsule in the top-right of the transcript during plan execution with phase names and pulse animations; clicking expands an inline detail popover showing checklist items, progress bars, artifact document links, and report copying without disturbing the main workspace.
- **Plugin DevKit & Extensibility**: First-class plugin SDK and CLI (`pi-plugin`) supporting custom webview panels, tool contributions, commands, and skills.
- **Safe Managed Mode & Containment**: First-class `auto` mode that restricts agent operations strictly to project folders, `.dcode` state and memory directories, and historically granted paths. Within bounds, the model can read, write, and delete files autonomously without dialogs; out-of-scope calls are immediately denied without interrupting the task loop.
- **Context Capacity & Reasoning Inspector**: Real-time context capacity ring and multi-segment breakdown in the composer toolbar. Accurately extracts reasoning/thought tokens (e.g. DeepSeek R1, Claude 3.7 Sonnet, OpenAI o-series) from standard conversation text, displaying system prompts, tools, reasoning, and messages with precision token calculations and cache hit rates.
- **Silent Microcompact Policy**: Intelligent trimming for historical tool results. Retains the latest tool call outputs while silently replacing older bulky outputs (`ReadFile`, `Bash`, `Grep`, `Glob`) with lightweight placeholders, slashing 50%~80% context tokens locally without requiring an expensive LLM summarization roundtrip.
- **Plan & Goal Workflow Stage Stepper**: Automatically parses multi-stage execution phases and step checklists from Markdown plans within the approval bar, rendering an interactive pipeline stepper (completed, in-progress, pending) and progress meter.
- **Modern UI Design System & Typography**: Standardized `--text-ui-*` semantic type ramp and optimized CJK font stack (Microsoft YaHei UI, PingFang SC, Noto Sans CJK) for monospace code and terminal blocks across platforms, eliminating jagged glyphs on Windows.
- **Local Remote Control Host**: Built-in RACP-WS host service in DCode desktop, enabling secure remote control from mobile devices or other clients across the LAN. Features single-use pairing token minting (`ppt1....`), real-time connected device metrics, and seamless token regeneration from Settings.

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

## Safe Managed Mode & Permission Security Boundaries

DCode implements an expressive, tiered permission model (`ask`, `accept-edits`, and `auto`). When operating under **Safe Managed Mode (`auto`)**, operations adhere to the following containment rules:

### 1. Authorized Scope
Tool access is strictly authorized across:
- **Project Workspaces**: All directories configured for the project group (multi-root `ProjectGroupRoot` collections).
- **`.dcode` State & Memory**: Global data directories (`~/.dcode`) and project-local `.dcode/` trees.
- **Granted External Paths**: Any external directory or file explicitly approved by the user and cached in `authorized_paths`.
- **Session Scratch**: An isolated execution sandbox directory (`scratch`) allocated per session.

### 2. Autonomous In-Scope Operations
Within the authorized scope, the LLM has complete operational freedom:
- Reading, writing, modifying, and **deleting** files (including shell deletion commands like `rm` and `del`, with the process current working directory locked to the workspace root) execute automatically without prompting the user.

### 3. Fail-Fast Out-of-Scope Containment (Non-Interrupting)
- Whenever a tool call targets paths outside the authorized scope:
  - The privileged native host (**DCore**) hard-rejects the request immediately (`PermissionDecision::Deny`).
  - **No approval card is displayed and task execution is never suspended or interrupted**.
  - The refusal is provided directly as a standard tool error result to the model.
  - The model recognizes the boundary error and autonomously adapts within the workspace, ensuring smooth and safe automated workflows.

---

## Plan Mode Closed-Loop & Interactive Capsule

DCode provides an end-to-end plan and goal execution closed-loop, featuring an intuitive floating capsule and detail popover for frictionless task observability:

### 1. Floating Plan Status Capsule
- Renders as a floating capsule in the top-right corner of the chat transcript whenever a plan/goal proposal is executing or completed.
- Displays the task title, a clean divider, and the active execution phase/step text in real time (e.g. `Phase 1: Dependency Probe`, `3/7 steps completed`).
- Includes a live pulsing indicator during execution and a clean checkmark upon completion, with single-click dismissal.

### 2. Lightweight Detail Popover
- **Non-intrusive presentation**: Clicking the capsule toggles an inline dropdown popover anchored beneath the capsule, **without opening or disturbing the wide right WorkPanel**.
- **Phase & Step Transparency**: Displays the overall progress percentage bar, individual phase badges, and active checklist step items (completed, in-progress, pending).
- **One-Click Actions**: Easily jump to the plan artifact markdown document or copy a formatted progress summary directly to the clipboard.

---

## Context Capacity Monitoring & Explicit Usage Metrics

To prevent unexpected context overflow and provide full transparency into LLM token consumption, DCode incorporates a comprehensive context management pipeline:

- **Real-Time Capacity Ring**: Embedded directly in the composer toolbar, visualizing active token usage against the model's maximum context limit.
- **Segmented Breakdown**: Distinguishes system prompts, declared tools, reasoning/thought traces, and conversation message history with precision token counts and cache hit awareness.
- **Silent Microcompaction**: Automatically prunes past bulky tool outputs (file reads, shell outputs) with lightweight placeholders, saving 50%~80% tokens locally with zero API latency.

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
