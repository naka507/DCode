---
name: GitHub Platform
description: GitHub workflow guide — gh CLI, Pull Requests, Actions, and the API patterns this project uses. Use when creating PRs, debugging CI, working with the GitHub API, or managing releases.
---

# GitHub Platform

Practical guide for GitHub as used in DCode/DCore development: CLI workflows, PR discipline, Actions CI, and API quirks.

## gh CLI

```bash
# PRs
gh pr create --title "..." --body "..." --head <branch> --base main
gh pr list --state open
gh pr view 27 --json merged,mergeable,state
gh pr merge 27 --merge          # merge commit (this project's convention)

# Runs
gh run list --branch main --limit 5
gh run view <run-id> --log-failed

# API (when gh doesn't cover it)
gh api repos/{owner}/{repo}/pulls/{n}/merge -X PUT -f merge_method=merge
```

## Pull Request Discipline

- **One PR = one purpose.** Feature + unrelated refactor in the same PR gets sent back.
- **Branch naming:** `feat/...`, `fix/...`, `docs/...`, `refactor/...`, `chore/...`.
- **Never push to `main` directly.** All changes land via PR with CI green.
- **Merge method is `merge`** (merge commit), not squash or rebase — preserves the branch history this project relies on for bisection.
- **Verify merged status after merging.** `gh pr view <n> --json merged` — a green CI on the branch is *not* proof it landed. (This bit us with PR #23: CI was green, PR was still open.)
- **The GitHub App can't push `.github/workflows/`.** Workflow files need manual web edits or a token with `workflows: write`. Plan for this.

## Actions CI Quirks

- **`secrets` can't be used directly in `if:` conditions.** Pass through a job-level `env:` first.
- **Fine-grained PATs for private repo checkout.** The token needs `contents: read` on the target repo; a missing `${{}}` interpolation silently sends the literal string.
- **No Actions API via the GitHub MCP tools.** To check workflow runs programmatically, use `gh run list` or the REST API — the MCP toolset doesn't cover it.
- **PR close/merge via API only.** The MCP `pull_request_read` doesn't support close/update; use `gh pr close` or the REST API.

## Releases

- Tag format: `v1.0.8` (semver, no prefix variations).
- Release notes: generated from merged PR titles since the last tag.
- Electron builds attach platform artifacts (`.exe`, `.dmg`, `.AppImage`) — built by `electron-builder`, uploaded in the release workflow.

## API Notes

- **Rate limits:** 5000 req/hour authenticated. The `X-RateLimit-Remaining` header tells you where you stand.
- **Pagination:** `?per_page=100&page=N`; follow `Link` headers.
- **Conditional requests:** send `If-None-Match` with the ETag to avoid burning quota on unchanged resources.
