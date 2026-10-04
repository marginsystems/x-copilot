CREATE TABLE IF NOT EXISTS approach_tasks (
  user_id TEXT PRIMARY KEY,
  phase TEXT NOT NULL,
  card_id TEXT,
  surface TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  owner TEXT NOT NULL DEFAULT 'desk',
  updated_at TEXT NOT NULL
);
