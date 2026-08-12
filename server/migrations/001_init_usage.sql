-- Platform usage ledger (SQLite now; keep portable for Postgres later).
-- schema_migrations is ensured by server/src/db.ts before this runs.
-- Local tenant row is seeded in ensureLocalTenant() after migrate.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS x_api_usage_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  at TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  error TEXT,
  posts_read INTEGER NOT NULL DEFAULT 0,
  cost_usd_micros INTEGER NOT NULL DEFAULT 0,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_x_api_usage_events_tenant_at
  ON x_api_usage_events (tenant_id, at);
