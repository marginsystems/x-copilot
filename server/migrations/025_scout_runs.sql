-- Compact, durable summary for each Scout collection run.

CREATE TABLE IF NOT EXISTS scout_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  sortie_id TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  queries_json TEXT NOT NULL,
  unique_candidate_ids INTEGER NOT NULL,
  rejection_counts_json TEXT NOT NULL,
  usable_additions INTEGER NOT NULL,
  cool_additions INTEGER NOT NULL,
  search_calls INTEGER NOT NULL,
  stop_reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scout_runs_tenant_finished
  ON scout_runs (tenant_id, finished_at);
