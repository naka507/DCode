/**
 * Web Fetch — fetch a URL and return its content as plain text.
 *
 * Uses Node's built-in fetch (the plugin runs in a Node.js utilityProcess).
 * Strips HTML tags, scripts, and styles; collapses whitespace. No JS
 * rendering — best for docs, articles, and API references.
 */

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function onLoad() {
  await pi.agent.registerTool({
    name: "web_fetch",
    description:
      "Fetch a URL and return its content as plain text (HTML stripped). For research and reading docs/pages.",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch (http/https)" },
        maxChars: { type: "number", description: "Max characters to return (default 20000)" },
      },
      required: ["url"],
    },
    execute: async (args) => {
      const url = String(args.url || "");
      if (!/^https?:\/\//i.test(url)) {
        return { ok: false, error: "URL must start with http:// or https://" };
      }
      try {
        const res = await fetch(url, {
          headers: { "user-agent": "DCode-web-fetch/0.1.0" },
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
        }
        const contentType = res.headers.get("content-type") || "";
        const text = await res.text();
        const plain = /html/i.test(contentType) ? htmlToText(text) : text;
        const max = args.maxChars || 20000;
        const truncated = plain.length > max;
        return {
          ok: true,
          url,
          contentType,
          truncated,
          text: truncated ? plain.slice(0, max) : plain,
        };
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    },
  });
}

async function onUnload() {
  await pi.agent.unregisterTool("web_fetch");
}

module.exports = { onLoad, onUnload };
