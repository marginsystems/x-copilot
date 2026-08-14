-- One row per Take off. Daily cap is counted per tenant, UTC day.

CREATE TABLE IF NOT EXISTS scout_sorties (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scout_sorties_tenant_at
  ON scout_sorties (tenant_id, at);
