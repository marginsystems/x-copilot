-- Daily For You inbox. Suggestions are next moves, not Scout leads.
-- Unused rows expire when the next daily run writes, or after 48h.

CREATE TABLE IF NOT EXISTS for_you_suggestions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  why TEXT NOT NULL,
  draft TEXT,
  target_id TEXT,
  target_url TEXT,
  target_author TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  acted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_for_you_user_active
  ON for_you_suggestions (user_id, status, expires_at);

CREATE TABLE IF NOT EXISTS for_you_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_for_you_runs_user_at
  ON for_you_runs (user_id, at);
