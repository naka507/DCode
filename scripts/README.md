# scripts

Repository automation. Every script here is invoked from a `package.json`
script, from a GitHub workflow, or by hand during a release; the alias column
gives the invocation the rest of the documentation quotes.

## Release gates

These are the checks that block a release. `release.mjs` runs the
release-documentation gate itself and refuses to tag while any version surface
disagrees, so a green `check:release-docs` is a precondition, not a substitute.

| Script | Alias | Purpose |
|---|---|---|
| `release.mjs` | `node scripts/release.mjs <version> [--tag]` | Bump every dcode version surface (`package.json`, `APP_VERSION`), commit, and optionally create the `vX.Y.Z` tag the Release workflow builds from. The Rust surfaces belong to the sibling `dcore` checkout and are verified, not rewritten |
| `check-release-docs.mjs` | `pnpm check:release-docs` | Verify the changelog, its test list, `APP_VERSION`, the sibling `dcore` Cargo versions, and the README release lines agree; an absent sibling is a failure, an absent README is reported as unverified |
| `check-agent-policy-sync.mjs` | `pnpm check:agent-policy` | Verify `AGENTS.md` and `CLAUDE.md` share the same `Policy-Sync` token, cross-references, and non-negotiable policy anchors |
| `check-style-tokens.mjs` | run by the desktop `lint` script | Fail renderer styles that hardcode values instead of design-system tokens |

## Packaging

| Script | Alias | Purpose |
|---|---|---|
| `release-macos.sh` | `scripts/release-macos.sh` | Signed and notarized local native macOS release lane. Requires `MAC_SIGNING_IDENTITY` and Apple notarization credentials; local package and distribution lanes remain unsigned when no signing identity is configured. |
| `staple-macos-release-dmg.sh` | `scripts/staple-macos-release-dmg.sh [release-dir]` | Attach Apple's notarization ticket (`xcrun stapler staple`) to the single DMG a native macOS job produced; run by the Release workflow when `sign_macos` is set |
| `verify-macos-release.sh` | `scripts/verify-macos-release.sh [release-dir]` | Fail unless the one `DCode.app` and DMG under the release directory are Developer ID-signed, notarized, and stapled; run by the Release workflow after stapling |
| `export-linux-asar.mjs` | `node scripts/export-linux-asar.mjs` | Copy the Linux `linux-unpacked/resources/app.asar` into the versioned release asset used for system-Electron repackaging |
| `check-linux-host-glibc.mjs` | `node scripts/check-linux-host-glibc.mjs [bin]` | Fail a Linux host-core binary whose needed glibc is above 2.35 |
| `make-icon.py` | `python3 scripts/make-icon.py` | Derive the package PNG, the macOS tray template, and the iconset/ICNS from the canonical PNG |
| `make-brand-marks.py` | `python3 scripts/make-brand-marks.py <source-dir>` | Re-derive the renderer's brand marks and mascot pairs, including the light/dark inversion, from the design exports |
| `make-dmg-background.py` | `python3 scripts/make-dmg-background.py <source-image>` | Re-cut `build/dmg-background.png` and its `@2x` companion from a design export at the size `build.dmg.window` pins |
| `publish-screenshots.py` | `python3 scripts/publish-screenshots.py` | Publish documentation screenshots |

## Development

| Script | Alias | Purpose |
|---|---|---|
| `dev-electron.mjs` | `pnpm dev`, through `predev` | Launch Electron against the dev server. On macOS it builds and reuses the fingerprinted branded host bundle under `.cache/electron-dev/` |

## End-to-end

Do not run these from an agent session, and do not trigger the remote jobs by
hand, unless the request explicitly asks for it (see `AGENTS.md`). The scenarios
they cover are specified in
[the E2E test plan](../docs/spec/06-delivery/04-e2e-test-plan.md).

| Script | Alias | Purpose |
|---|---|---|
| `e2e-smoke.mjs` | `npm run test:e2e` | Protocol-level E2E against host-core, plus an optional live model |
| `e2e-agent-live.mjs` | `npm run test:e2e:agent-live` | Live streaming chat through agent-runtime + host-core. Requires `DCODE_TEST_API_KEY`, `DCODE_TEST_BASE_URL`, and `DCODE_TEST_MODEL` (no defaults) |
| `e2e-capability-move.mjs` | `npm run test:e2e:capability-move` | Moving a skill, MCP server or subagent between the global and project scopes |
| `e2e-composer-autocomplete.mjs` | `npm run test:e2e:composer-autocomplete` | The composer's `@` / `/` autocomplete popup and its layout |
| `e2e-composer-paste.mjs` | `npm run test:e2e:composer-paste` | Pasting text and images into the composer |
| `e2e-electron-boot.mjs` | `npm run test:e2e:boot` | Electron boot probe |
| `e2e-plan.mjs` | `npm run test:e2e:plan` | Plan state, checkpoint artifact, and approval transitions |
| `e2e-plan-ui.mjs` | `npm run test:e2e:plan-ui` | Plan approval through the rendered UI |
| `e2e-plugin-import-deps.mjs` | `npm run test:e2e:plugin-import-deps` | Plugin import dependency resolution |
| `e2e-provider-api-style.mjs` | `npm run test:e2e:provider-api-style` | Custom-provider API-format boundary through the rendered settings dialog |
| `e2e-provider-order.mjs` | `npm run test:e2e:provider-order` | Provider drag/drop through the settings UI, production IPC and a real Rust host |
| `e2e-provider-ipc-payload.mjs` | `npm run test:e2e:provider-ipc-payload` | Saving a new AI service across the real `window.dcode.invoke` boundary, which `structuredClone` enforces |
| `e2e-remote-host.mjs` | `npm run test:e2e:remote-host` | Remote host attach and reconnect |
| `e2e-rpc-unicode.mjs` | `npm run test:e2e:rpc-unicode` | Unicode round-tripping across the RPC boundary |
| `e2e-session-collaboration.mjs` | `npm run test:e2e:collaboration` | Multi-participant session collaboration |
| `e2e-session-completion.mjs` | `npm run test:e2e:session-completion` | Session completion and its persisted outcome |
| `e2e-subagent-models.mjs` | `npm run test:e2e:subagent-models` | Per-subagent model and fallback-model selection |
| `e2e-subagents.mjs` | `npm run test:e2e:subagents` | Subagent registry over RPC, then through the real loader (D202) |
| `e2e-supervision.mjs` | `npm run test:e2e:supervision` | Process supervision and restart behavior |
| `e2e-theme-surfaces.mjs` | `npm run test:e2e:theme-surfaces` | Theme application across the renderer's surfaces |
| `e2e-three-column-layout.mjs` | `npm run test:e2e:layout` | The three-column frame: sidebar, main pane, work panel |
| `e2e-transcript-render.mjs` | `npm run test:e2e:transcript-render` | Stable completed activity groups, the tail runtime status lane, and the compact turn process (E2E-083) |
| `e2e-trusted-extensions.mjs` | `npm run test:e2e:trusted-extensions` | The trusted-extension prompt and grant flow |
 | `e2e-window-controls.mjs` | `npm run test:e2e:window-controls` | Window controls stay visible and hit-testable through the work-panel flow (E2E-CHROME-window-controls-survive-work-panel) |

`scripts/e2e/` holds the shared drivers these import (`boot.mjs`, `fixture.mjs`,
`assert.mjs`, `plan.mjs`, `wait.mjs`, and the surface helpers); it is not itself a
runner.

## Continuous integration

`.github/workflows/ci.yml` runs two jobs on pushes to `main`, on pull requests,
and on manual dispatch, skipping both when a change touches only `docs/**` or
`**/*.md`:

- **JS build / typecheck / lint / test** — `pnpm install --frozen-lockfile`,
  `pnpm build:js`, `pnpm --filter @dcode/desktop typecheck`, `pnpm lint`,
  `pnpm -r --if-present test`
- **Rust host-core test** — `cargo test -p host-core --locked`

`.github/workflows/docs-check.yml` covers the paths `ci.yml` ignores: it runs
`pnpm docs:check` (the docs locale pair check) when `docs/**`, the READMEs, the
shared changelog sources, or the check scripts change. `check:release-docs` is
deliberately not in CI because it fails on rc versions by design.

`.github/workflows/release.yml` builds on a `v*.*.*` tag. A `verify` job first
repeats the `ci.yml` checks (a tag push does not trigger `ci.yml`), and the
build matrix waits for it. Each platform runner then
validates the tag against `package.json` before packaging, then
runs the native `dist:mac`, `dist:win`, or `dist:linux` command. The Linux
job uses Ubuntu 22.04 so host-core stays on glibc 2.35, then
`scripts/check-linux-host-glibc.mjs` refuses a binary that needs a newer
glibc. The Linux runner also exports the exact app.asar from `linux-unpacked`
as a versioned release asset; the macOS matrix covers arm64 and Intel x64 and
the publish job assembles the GitHub Release. The release workflow defaults to
unsigned macOS artifacts; manually dispatch it with `sign_macos: true` to opt
into signing and notarization. See the [release
runbook](../docs/spec/06-delivery/06-release-runbook.md).
