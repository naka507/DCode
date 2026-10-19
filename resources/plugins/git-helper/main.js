/**
 * Git Helper — read-only git introspection tools for the agent.
 *
 * Deliberately read-only: no commit, push, reset, or checkout. The agent
 * uses the DCode Bash tool when it needs to write.
 */

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

async function workspaceDir() {
  const ws = await pi.workspace.get();
  if (!ws || !ws.path) throw new Error("No workspace open");
  return ws.path;
}

async function git(args, cwd) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, timeout: 15000 });
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
    name: "git_status",
    description: "Show working tree status: branch, ahead/behind, staged and unstaged changes.",
    risk: "low",
    schema: { type: "object", properties: {} },
    execute: async () => {
      const cwd = await workspaceDir();
      return git(["status", "--short", "--branch"], cwd);
    },
  });

  await pi.agent.registerTool({
    name: "git_diff_summary",
    description: "Show a summary of uncommitted changes (diffstat).",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        staged: { type: "boolean", description: "Show staged diff instead of unstaged" },
      },
    },
    execute: async (args) => {
      const cwd = await workspaceDir();
      const cmd = ["diff", "--stat"];
      if (args.staged) cmd.push("--cached");
      return git(cmd, cwd);
    },
  });

  await pi.agent.registerTool({
    name: "git_log",
    description: "Show recent commit history with hash, author, date, and subject.",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of commits (default 10)" },
      },
    },
    execute: async (args) => {
      const cwd = await workspaceDir();
      return git(
        ["log", `--max-count=${args.limit || 10}`, "--format=%h %an %ad %s", "--date=short"],
        cwd,
      );
    },
  });

  await pi.agent.registerTool({
    name: "git_branch",
    description: "Show the current branch, upstream tracking, and all local branches.",
    risk: "low",
    schema: { type: "object", properties: {} },
    execute: async () => {
      const cwd = await workspaceDir();
      return git(["branch", "-vv"], cwd);
    },
  });
}

async function onUnload() {
  for (const name of ["git_status", "git_diff_summary", "git_log", "git_branch"]) {
    await pi.agent.unregisterTool(name);
  }
}

module.exports = { onLoad, onUnload };
