---
name: Browser Automation with agent-browser
description: Browser automation CLI using Chrome DevTools Protocol (CDP). Use when navigating web pages, filling forms, clicking elements, taking snapshots with element refs, taking screenshots, or automating web testing.
---

# Browser Automation with agent-browser

`agent-browser` is a lightweight browser automation CLI for AI agents. It interacts with Chrome/Chromium directly via Chrome DevTools Protocol (CDP) and enables deterministic, reference-based DOM inspection and interaction.

## Core Workflow

Every browser automation task follows this deterministic loop:

1. **Navigate**: `agent-browser open <url>`
2. **Snapshot**: `agent-browser snapshot -i` (generates stable element references like `@e1`, `@e2`)
3. **Interact**: Use element references to click, fill, or select
4. **Re-snapshot**: When the DOM changes or navigation occurs, take a fresh snapshot

```bash
agent-browser open https://example.com/login
agent-browser snapshot -i
# Output: @e1 [input type="email"], @e2 [input type="password"], @e3 [button] "Sign In"

agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "secret123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i  # Verify dashboard loaded
```

## Command Chaining

Commands can be chained with `&&` within a single shell invocation. Because the browser instance runs in the background, chaining avoids process spin-up overhead:

```bash
# Open URL, wait for idle, and take snapshot in one step
agent-browser open https://example.com && agent-browser wait --load networkidle && agent-browser snapshot -i

# Chain form interactions
agent-browser fill @e1 "user@example.com" && agent-browser fill @e2 "secret123" && agent-browser click @e3

# Navigate and capture proof
agent-browser open https://example.com && agent-browser wait --load networkidle && agent-browser screenshot page.png
```

## Element References (`@e1`, `@e2`, ...)

- Always run `snapshot -i` before attempting to interact with elements.
- References are scoped to the current DOM state. If the page reloads, routes, or mutates significantly, run `agent-browser snapshot -i` to refresh references.
- Selectors can also fall back to standard CSS selectors when needed:
  ```bash
  agent-browser click "button[type='submit']"
  agent-browser fill "#search-input" "query"
  ```

## Key Commands Reference

- `agent-browser open <url>`: Navigate to the specified URL.
- `agent-browser snapshot -i`: Render interactive element tree with `@e` references.
- `agent-browser click <ref|selector>`: Click an element.
- `agent-browser fill <ref|selector> <text>`: Type text into an input field.
- `agent-browser select <ref|selector> <value>`: Select an option from a dropdown.
- `agent-browser screenshot [filepath]`: Save a full-page or viewport screenshot.
- `agent-browser wait --load networkidle`: Wait until network traffic settles.
- `agent-browser eval <script>`: Evaluate JavaScript directly in the page context.
- `agent-browser close`: Terminate the running browser session.
