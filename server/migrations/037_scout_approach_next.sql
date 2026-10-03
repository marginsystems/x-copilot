CREATE TABLE IF NOT EXISTS scout_approach_next (
  user_id TEXT PRIMARY KEY,
  card_json TEXT,
  updated_at TEXT NOT NULL
);
