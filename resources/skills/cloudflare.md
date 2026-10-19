---
name: Cloudflare Platform
description: Cloudflare Workers, Pages, and platform services guide. Use when deploying to Cloudflare, writing Workers, configuring Pages, or working with R2/KV/D1/Durable Objects.
---

# Cloudflare Platform

Guide for Cloudflare's developer platform: Workers (edge compute), Pages (static hosting), and the storage/coordination primitives.

## When to Apply

- Deploying a service to Workers or a site to Pages
- Writing or debugging a Worker (Hono, itty-router, or raw fetch handler)
- Choosing between KV, R2, D1, Durable Objects for state
- Configuring custom domains, redirects, or headers

## Workers

- **Entry point is a `fetch` handler.** `export default { async fetch(request, env, ctx) { ... } }` — no Node server, no ports.
- **No Node APIs by default.** `node:fs`, `node:net`, etc. don't exist at the edge. Use Web standards (`fetch`, `Request`, `Response`, `crypto.subtle`) or enable the `nodejs_compat` flag for a subset.
- **Bindings, not env vars, for platform services.** KV, R2, D1, Queues are accessed via `env.MY_KV`, configured in `wrangler.toml` — never hardcode account IDs or keys.
- **Keep Workers small and fast.** 10ms CPU budget on the free plan; cold starts are negligible but per-request CPU is metered. Heavy compute goes to a backend, not the edge.
- **`wrangler dev` for local testing**, `wrangler deploy` to ship. `wrangler tail` streams live logs.

## Storage: Picking the Right Primitive

| Need | Use | Notes |
| ---- | --- | ----- |
| Key-value config, feature flags | Workers KV | Eventually consistent, fast reads, slow writes |
| File/blob storage | R2 | S3-compatible, zero egress fees |
| Relational queries | D1 | SQLite at the edge, read replicas |
| Single-writer coordination, WebSockets | Durable Objects | Strong consistency, per-object serialization |
| Ephemeral per-request cache | Cache API | `caches.default`, standard HTTP semantics |

Don't use KV as a database (no queries, no transactions). Don't use D1 for blobs (use R2).

## Pages

- **Static output goes to Pages.** Framework adapters (`@cloudflare/next-on-pages`, etc.) or plain static files.
- **Functions for dynamic routes.** `functions/api/[[route]].ts` — file-based routing, same Worker runtime.
- **Preview deployments per PR.** Every pull request gets a `*.pages.dev` URL automatically.

## Common Gotchas

- **No long-lived connections.** WebSockets need Durable Objects; plain Workers can't hold sockets open.
- **Subrequests limit.** 50 subrequests per invocation on the free plan (recursion counts).
- **Timezone is UTC.** Always. Don't rely on local time.
- **Secrets via `wrangler secret put`,** never in `wrangler.toml` or code.
