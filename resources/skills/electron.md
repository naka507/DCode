---
name: Electron Desktop App Automation
description: Automate and test Electron desktop applications using Chrome DevTools Protocol via remote debugging port. Use for connecting to, inspecting, and automating running Electron apps.
---

# Electron Desktop App Automation

Automate Electron desktop applications using Chrome DevTools Protocol (CDP). Because Electron is built on Chromium, any Electron app can expose a CDP debugging port, enabling automated DOM snapshots, interaction, and visual inspection.

## Core Workflow

1. **Launch** the target Electron app with remote debugging enabled
2. **Connect** the automation client to the CDP port
3. **Snapshot** to discover interactive elements
4. **Interact** using element references or selectors
5. **Re-snapshot** after navigation or UI state transitions

```bash
# Launch app with remote debugging
# macOS
open -a "MyElectronApp" --args --remote-debugging-port=9222

# Windows
& "C:\Path\To\MyElectronApp.exe" --remote-debugging-port=9222

# Linux
./my-electron-app --remote-debugging-port=9222
```

## Automating with agent-browser

Once the Electron app is launched with `--remote-debugging-port=9222`, connect `agent-browser` directly:

```bash
# Connect to running Electron app
agent-browser connect 9222

# Inspect UI elements
agent-browser snapshot -i
# Output: @e1 [button] "New Window", @e2 [input] "Search..."

# Interact
agent-browser click @e1
agent-browser screenshot electron-window.png
```

## Best Practices for Electron Testing

1. **Use Dedicated Ports**: Assign unique ports per test run (e.g. 9222, 9223) to avoid port collisions when running parallel suites.
2. **Handle Multi-Window Setups**: Electron applications frequently use multiple `BrowserWindow` instances or Webviews. Query `http://localhost:9222/json/list` to inspect all open targets and attach to the primary window.
3. **Inspect Main Process vs Renderer Process**:
   - UI bugs and rendering issues live in the Chromium Renderer process (accessible via CDP).
   - IPC and OS-level issues live in the Node.js Main process (inspectable via `--inspect=...` Node inspector flags).
