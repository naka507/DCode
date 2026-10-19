/**
 * GitHub PR Assistant — agent tools for the PR workflow via the `gh` CLI.
 *
 * Requires `gh` to be installed and authenticated (`gh auth login`).
 * All commands run in the current DCode workspace directory.
 */

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

async function workspaceDir() {
  const ws = await pi.workspace.get();
  if (!ws || !ws.path) throw new Error("No workspace open");
  return ws.path;
}

async function gh(args, cwd) {
  try {
    const { stdout } = await execFileAsync("gh", args, { cwd, timeout: 30000 });
    return { ok: true, output: stdout.trim() };
  } catch (err) {
    return {
      ok: false,
      error: (err.stderr || err.message || String(err)).trim(),
    };
  }
}

async function onLoad() {
  await pi.agent.registerTool({
    name: "github_pr_create",
    description: "Create a GitHub pull request from the current branch. Returns the PR number and URL.",
    risk: "medium",
    schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "PR title" },
        body: { type: "string", description: "PR body (markdown)" },
        base: { type: "string", description: "Base branch, defaults to main" },
        draft: { type: "boolean", description: "Create as draft PR" },
      },
      required: ["title", "body"],
    },
    execute: async (args) => {
      const cwd = await workspaceDir();
      const cmd = ["pr", "create", "--title", args.title, "--body", args.body];
      if (args.base) cmd.push("--base", args.base);
      if (args.draft) cmd.push("--draft");
      return gh(cmd, cwd);
    },
  });

  await pi.agent.registerTool({
    name: "github_pr_list",
    description: "List pull requests in the current repo with number, title, state, and CI status.",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        state: { type: "string", enum: ["open", "closed", "merged", "all"] },
        limit: { type: "number", description: "Max results (default 10)" },
      },
    },
    execute: async (args) => {
      const cwd = await workspaceDir();
      const cmd = [
        "pr", "list",
        "--state", args.state || "open",
        "--limit", String(args.limit || 10),
        "--json", "number,title,state,headRefName,baseRefName,statusCheckRollup",
      ];
      const r = await gh(cmd, cwd);
      if (!r.ok) return r;
      try {
        return { ok: true, prs: JSON.parse(r.output) };
      } catch {
        return r;
      }
    },
  });

  await pi.agent.registerTool({
    name: "github_pr_view",
    description: "View PR details: title, state, merged status, mergeable state.",
    risk: "low",
    schema: {
      type: "object",
      properties: { number: { type: "number", description: "PR number" } },
      required: ["number"],
    },
    execute: async (args) => {
      const cwd = await workspaceDir();
      const r = await gh(
        ["pr", "view", String(args.number), "--json",
         "number,title,state,merged,mergeable,mergeStateStatus,url,headRefName,baseRefName"],
        cwd,
      );
      if (!r.ok) return r;
      try {
        return { ok: true, pr: JSON.parse(r.output) };
      } catch {
        return r;
      }
    },
  });

  await pi.agent.registerTool({
    name: "github_pr_checks",
    description: "Show CI check runs for a PR: name, status, and conclusion.",
    risk: "low",
    schema: {
      type: "object",
      properties: { number: { type: "number", description: "PR number" } },
      required: ["number"],
    },
    execute: async (args) => {
      const cwd = await workspaceDir();
      return gh(["pr", "checks", String(args.number)], cwd);
    },
  });

  await pi.agent.registerTool({
    name: "github_pr_merge",
    description: "Merge a pull request with a merge commit. Check CI with github_pr_checks first.",
    risk: "high",
    schema: {
      type: "object",
      properties: { number: { type: "number", description: "PR number" } },
      required: ["number"],
    },
    execute: async (args) => {
      const cwd = await workspaceDir();
      return gh(["pr", "merge", String(args.number), "--merge"], cwd);
    },
  });
}

async function onUnload() {
  for (const name of [
    "github_pr_create", "github_pr_list", "github_pr_view",
    "github_pr_checks", "github_pr_merge",
  ]) {
    await pi.agent.unregisterTool(name);
  }
}

module.exports = { onLoad, onUnload };
