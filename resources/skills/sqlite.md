---
name: SQLite
description: SQLite patterns for DCore (host-core) — schema design, migrations, queries, and the ownership rules. Use when working with persistence in crates/host-core/src/db/ — SQLite is owned exclusively by the Rust host.
---

# SQLite for DCore

DCore owns all persistence via SQLite (`~/.dcode/pi.sqlite`). The renderer never touches the DB; DCode accesses data only through the JSON-RPC surface. These guidelines cover the Rust side.

## When to Apply

- Adding tables or columns (requires migration)
- Writing repository queries in `crates/host-core/src/db/`
- Debugging data issues or migration failures

## Schema & Migrations

- **Every schema change needs a migration.** New table, new column, new index — all go through the migration runner with a version bump. No exceptions.
- **Migrations are forward-only and idempotent.** They must run cleanly on an existing user DB with real data. Test against a DB at the previous schema version, not an empty one.
- **Never assume an empty database.** Users have months of sessions, turns, and events. `ALTER TABLE ... ADD COLUMN` needs a sensible default or nullable.
- **Schema version is the contract.** DCode's `SCHEMA_VERSION` (16) is DCode's own state — don't confuse it with DCore's SQLite schema version. They're independent.

## Queries

- **Parameterized queries only.** Never interpolate values into SQL strings — use `?` placeholders. This is a security boundary (user input reaches these queries).
- **Index the access patterns.** Turn events are queried by `turn_id` ordered by `seq`; sessions by `id` and `project_path`. If you add a query, check `EXPLAIN QUERY PLAN`.
- **Batch writes in transactions.** Turn event appends, session updates — wrap related writes in a single transaction. Partial writes leave the DB in an inconsistent state.
- **64KB payload limit.** Turn event payloads are capped — enforce at the RPC boundary, not in the DB layer.

## Concurrency

- **SQLite is single-writer.** All writes go through one connection (or a mutex-guarded pool). Readers can be concurrent via WAL mode.
- **No long-running transactions.** A transaction that holds the write lock blocks all other writes. Keep transactions short: prepare, write, commit.
- **Busy timeout, not infinite wait.** Set `busy_timeout` (e.g. 5s) — a hung writer shouldn't deadlock the host forever.

## Ownership Rules

- **Only Rust touches SQLite.** No TypeScript, no renderer, no sidecar opens the DB file directly. All access is via DCore's RPC methods.
- **Repository pattern.** Each domain (sessions, turns, events, permissions) has its own module under `src/db/`. Cross-domain queries go through the repositories, not raw SQL scattered in handlers.
- **Test against temp DBs.** Unit/integration tests use a temporary SQLite file, never `~/.dcode/pi.sqlite`. The test helper creates a fresh DB per test.

## Debugging

- **Inspect with `sqlite3` CLI.** `sqlite3 ~/.dcode/pi.sqlite "SELECT * FROM turns LIMIT 5;"` — but back up first, and never write to the live DB by hand.
- **Check the schema version first.** `PRAGMA user_version;` — if it doesn't match what the code expects, it's a migration issue.
- **WAL files.** If you see `-wal`/`-shm` files next to the DB, that's normal (WAL mode). Don't delete them while the host is running.
