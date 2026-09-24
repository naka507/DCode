/**
 * Built-in open-source MCP server presets and cross-platform remote sync utilities.
 */

import type { McpServerInput } from "./types.js";

export type McpPresetCategory = "utility" | "database" | "developer" | "browser";

export type McpPreset = {
  id: string;
  name: string;
  description: string;
  category: McpPresetCategory;
  server: McpServerInput;
};

/**
 * Curated list of popular, production-grade open-source MCP servers.
 */
export const MCP_PRESETS: readonly McpPreset[] = [
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Read, write, and explore files and directories with secure path scoping.",
    category: "utility",
    server: {
      id: "filesystem",
      label: "Filesystem Server",
      description: "Direct local file access via official Model Context Protocol server.",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      enabled: true,
    },
  },
  {
    id: "fetch",
    name: "Web Fetch",
    description: "Fetch web pages, convert HTML to clean Markdown, and inspect API responses.",
    category: "utility",
    server: {
      id: "fetch",
      label: "Fetch & Web Content",
      description: "Direct HTTP GET/POST fetcher with automatic HTML-to-markdown translation.",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-fetch"],
      enabled: true,
    },
  },
  {
    id: "sqlite",
    name: "SQLite Database",
    description: "Query and inspect local SQLite database schemas, tables, and records.",
    category: "database",
    server: {
      id: "sqlite",
      label: "SQLite Explorer",
      description: "Local database queries and table structure inspection.",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "database.sqlite"],
      enabled: true,
    },
  },
  {
    id: "github",
    name: "GitHub",
    description: "Search repositories, read code, create pull requests, and manage issues.",
    category: "developer",
    server: {
      id: "github",
      label: "GitHub API",
      description: "GitHub repository and issue management via personal access token.",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "",
      },
      enabled: true,
    },
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Read-only and read-write schema and query inspector for PostgreSQL databases.",
    category: "database",
    server: {
      id: "postgres",
      label: "PostgreSQL Inspector",
      description: "Database table schema and query runner.",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"],
      enabled: true,
    },
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Privacy-focused web and local search using the Brave Search API.",
    category: "utility",
    server: {
      id: "brave-search",
      label: "Brave Search",
      description: "Web search engine integration for up-to-date documentation and information.",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: {
        BRAVE_API_KEY: "",
      },
      enabled: true,
    },
  },
  {
    id: "puppeteer",
    name: "Puppeteer Browser",
    description: "Automate Chromium browser tasks, render pages, and take visual screenshots.",
    category: "browser",
    server: {
      id: "puppeteer",
      label: "Puppeteer Browser",
      description: "Headless browser automation and screenshot capture.",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-puppeteer"],
      enabled: true,
    },
  },
  {
    id: "memory",
    name: "Knowledge Graph Memory",
    description: "Graph-based persistent knowledge base for entities, relations, and context.",
    category: "utility",
    server: {
      id: "memory",
      label: "Memory Graph",
      description: "Persistent entity and knowledge graph storage across sessions.",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      enabled: true,
    },
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "Dynamic multi-step reasoning server for decomposing complex engineering problems.",
    category: "developer",
    server: {
      id: "sequential-thinking",
      label: "Sequential Thinking",
      description: "Structured thought steps, hypothesis evaluation, and thought graph branches.",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      enabled: true,
    },
  },
];

export interface RemoteSyncOptions {
  localRoot?: string;
  remoteRoot?: string;
  targetOs?: "linux" | "darwin" | "windows";
}

/**
 * Normalize and rewrite MCP server configurations for remote execution environments.
 *
 * When transferring or syncing an MCP configuration from local to a remote host:
 * 1. Normalizes CLI command extensions (e.g. `npx.cmd` -> `npx` on Unix).
 * 2. Rewrites filesystem path arguments and environment variables across OS boundaries.
 * 3. Converts Windows backslashes (`\`) to forward slashes (`/`) for Linux/macOS targets.
 */
export function rewriteMcpServerForRemoteHost(
  server: McpServerInput,
  options: RemoteSyncOptions = {},
): McpServerInput {
  const targetOs = options.targetOs ?? "linux";
  const cloned: McpServerInput = JSON.parse(JSON.stringify(server));

  // 1. Normalize stdio command
  if (cloned.transport === "stdio" && cloned.command) {
    let cmd = cloned.command.trim();
    if (targetOs !== "windows") {
      if (cmd.toLowerCase().endsWith(".cmd") || cmd.toLowerCase().endsWith(".bat") || cmd.toLowerCase().endsWith(".exe")) {
        cmd = cmd.replace(/\.(cmd|bat|exe)$/i, "");
      }
    }
    cloned.command = cmd;
  }

  // Helper to replace root path prefixes
  const rewritePathString = (val: string): string => {
    let res = val;
    if (options.localRoot && options.remoteRoot && res.startsWith(options.localRoot)) {
      res = options.remoteRoot + res.slice(options.localRoot.length);
    }
    if (targetOs !== "windows") {
      // Replace Windows backslashes in paths
      res = res.replace(/\\/g, "/");
    }
    return res;
  };

  // 2. Rewrite path in args
  if (cloned.args && Array.isArray(cloned.args)) {
    cloned.args = cloned.args.map((arg) => {
      if (typeof arg !== "string") return arg;
      // If it looks like a path or begins with local root
      if (
        (options.localRoot && arg.includes(options.localRoot)) ||
        /^[a-zA-Z]:[\\/]/.test(arg) ||
        arg.includes("\\")
      ) {
        return rewritePathString(arg);
      }
      return arg;
    });
  }

  // 3. Rewrite path in env
  if (cloned.env && typeof cloned.env === "object") {
    for (const [k, v] of Object.entries(cloned.env)) {
      if (typeof v === "string") {
        if (
          (options.localRoot && v.includes(options.localRoot)) ||
          /^[a-zA-Z]:[\\/]/.test(v) ||
          v.includes("\\")
        ) {
          cloned.env[k] = rewritePathString(v);
        }
      }
    }
  }

  return cloned;
}
