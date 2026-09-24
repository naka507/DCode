"use strict";

/**
 * Terminal — Work-panel shell runner and command executor plugin.
 */

const { spawn } = require("node:child_process");
const os = require("node:os");

let activeProcess = null;
let activeProcessId = null;

function resolveShell() {
  if (process.platform === "win32") {
    return process.env.ComSpec || "cmd.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

function resolveShellArgs(cmd) {
  if (process.platform === "win32") {
    const isPowerShell = (process.env.SHELL && /powershell|pwsh/i.test(process.env.SHELL)) || false;
    if (isPowerShell) {
      return ["-NoProfile", "-NonInteractive", "-Command", cmd];
    }
    return ["/d", "/s", "/c", cmd];
  }
  return ["-c", cmd];
}

async function getWorkspaceRoot() {
  try {
    const workspace = await pi.workspace.get();
    if (workspace && workspace.path) return workspace.path;
  } catch {
    // fallback
  }
  return process.cwd();
}

async function handleInfo() {
  const cwd = await getWorkspaceRoot();
  return {
    ok: true,
    platform: process.platform,
    shell: resolveShell(),
    cwd,
    homedir: os.homedir(),
    activeCommand: activeProcessId ? { id: activeProcessId } : null,
  };
}

async function handleKill() {
  if (activeProcess && !activeProcess.killed) {
    try {
      activeProcess.kill("SIGTERM");
    } catch {
      // ignore
    }
    activeProcess = null;
    activeProcessId = null;
    return { ok: true, killed: true };
  }
  return { ok: true, killed: false };
}

async function handleExec(payload) {
  const rawCommand = String(payload?.command ?? "").trim();
  if (!rawCommand) {
    return { ok: false, error: "Command cannot be empty" };
  }

  const cwd = payload?.cwd ? String(payload.cwd) : await getWorkspaceRoot();
  const timeoutMs = typeof payload?.timeoutMs === "number" && payload.timeoutMs > 0 ? payload.timeoutMs : 60000;

  if (activeProcess && !activeProcess.killed) {
    try {
      activeProcess.kill("SIGTERM");
    } catch {
      // ignore
    }
  }

  const shell = resolveShell();
  const args = resolveShellArgs(rawCommand);

  return new Promise((resolve) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;

    const proc = spawn(shell, args, {
      cwd,
      env: { ...process.env },
      windowsHide: true,
    });

    activeProcess = proc;
    activeProcessId = rawCommand;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        // ignore
      }
      activeProcess = null;
      activeProcessId = null;
      resolve({
        ok: false,
        timedOut: true,
        exitCode: -1,
        stdout: stdoutBuffer,
        stderr: stderrBuffer + `\n[Process timed out after ${timeoutMs}ms]`,
      });
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      if (stdoutBuffer.length > 500000) {
        stdoutBuffer = stdoutBuffer.slice(-400000);
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString("utf8");
      if (stderrBuffer.length > 200000) {
        stderrBuffer = stderrBuffer.slice(-150000);
      }
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeProcess = null;
      activeProcessId = null;
      resolve({
        ok: false,
        exitCode: -1,
        error: String(err?.message ?? err),
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
      });
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeProcess = null;
      activeProcessId = null;
      resolve({
        ok: code === 0,
        exitCode: code ?? 0,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
      });
    });
  });
}

const CHANNELS = {
  "terminal.info": handleInfo,
  "terminal.exec": handleExec,
  "terminal.kill": handleKill,
};

async function onPanelInvoke(channel, payload) {
  const handler = CHANNELS[channel];
  if (!handler) {
    return { ok: false, error: `unknown channel: ${channel}` };
  }
  try {
    return await handler(payload ?? {});
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

async function onLoad() {
  try {
    await pi.agent.registerTool({
      name: "Terminal",
      description: "Run a shell command in the project workspace root and return the execution results.",
      risk: "medium",
      schema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to run.",
          },
          timeoutMs: {
            type: "number",
            description: "Execution timeout in milliseconds (default 60000).",
          },
        },
        required: ["command"],
      },
      handler: async (args) => {
        const result = await handleExec({
          command: args.command,
          timeoutMs: args.timeoutMs,
        });
        return {
          content: [
            {
              type: "text",
              text: result.ok
                ? (result.stdout || "[Command completed successfully with no output]")
                : `Command failed (exit code ${result.exitCode}):\n${result.stderr || result.stdout || result.error || "Unknown error"}`,
            },
          ],
        };
      },
    });
  } catch {
    // Non-fatal if tool register is unavailable
  }
}

async function onUnload() {
  if (activeProcess && !activeProcess.killed) {
    try {
      activeProcess.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  activeProcess = null;
  activeProcessId = null;
}

module.exports = { onLoad, onUnload, onPanelInvoke };
