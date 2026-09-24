"use strict";

/**
 * Documents — Work-panel rich document and specification viewer plugin.
 */

const fs = require("node:fs");
const path = require("node:path");

async function getWorkspaceRoot() {
  try {
    const ws = await pi.workspace.get();
    if (ws && ws.path) return ws.path;
  } catch {
    // fallback
  }
  return process.cwd();
}

function parseOutline(content) {
  const lines = content.split(/\r?\n/);
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        line: i + 1,
      });
    }
  }
  return headings;
}

async function handleRead(payload) {
  const root = await getWorkspaceRoot();
  let targetPath = String(payload?.path ?? "").trim();
  if (!targetPath) {
    // Return sample readme or overview if nothing requested
    const candidates = ["README.md", "README.en.md", "docs/README.md", "AGENTS.md"];
    for (const c of candidates) {
      const full = path.resolve(root, c);
      if (fs.existsSync(full)) {
        targetPath = c;
        break;
      }
    }
  }

  if (!targetPath) {
    return {
      ok: true,
      path: "",
      name: "Welcome",
      content: "# Documents\n\nNo document selected. Open a Markdown or PDF file from the project to view formatted documentation.",
      headings: [],
      stats: { words: 15, lines: 3 },
    };
  }

  const resolved = path.isAbsolute(targetPath) ? targetPath : path.resolve(root, targetPath);
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: `File not found: ${targetPath}` };
  }

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    return { ok: false, error: `Path is a directory: ${targetPath}` };
  }

  const ext = path.extname(resolved).toLowerCase();
  const name = path.basename(resolved);

  if (ext === ".pdf") {
    // Base64 encode for PDF viewer up to 10MB
    if (stat.size > 10 * 1024 * 1024) {
      return { ok: false, error: "PDF exceeds 10MB limit." };
    }
    const buf = fs.readFileSync(resolved);
    return {
      ok: true,
      path: targetPath,
      name,
      isPdf: true,
      size: stat.size,
      dataUrl: `data:application/pdf;base64,${buf.toString("base64")}`,
    };
  }

  // Text / Markdown up to 3MB
  if (stat.size > 3 * 1024 * 1024) {
    return { ok: false, error: "Document exceeds 3MB limit." };
  }

  const text = fs.readFileSync(resolved, "utf8");
  const headings = parseOutline(text);
  const words = text.split(/\s+/).filter(Boolean).length;
  const lines = text.split(/\r?\n/).length;

  return {
    ok: true,
    path: targetPath,
    name,
    isPdf: false,
    content: text,
    headings,
    stats: {
      words,
      lines,
      size: stat.size,
      readTimeMin: Math.max(1, Math.round(words / 200)),
    },
  };
}

async function handleListDocs() {
  const root = await getWorkspaceRoot();
  const results = [];

  function scan(dir, depth) {
    if (depth > 3 || results.length >= 50) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".") || ent.name === "node_modules" || ent.name === "dist") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        scan(full, depth + 1);
      } else if (/\.(md|markdown|txt|pdf)$/i.test(ent.name)) {
        const rel = path.relative(root, full).replace(/\\/g, "/");
        results.push({ name: ent.name, path: rel });
      }
    }
  }

  scan(root, 0);
  return { ok: true, docs: results };
}

const CHANNELS = {
  "docs.read": handleRead,
  "docs.list": handleListDocs,
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

async function onLoad() {}
async function onUnload() {}

module.exports = { onLoad, onUnload, onPanelInvoke };
