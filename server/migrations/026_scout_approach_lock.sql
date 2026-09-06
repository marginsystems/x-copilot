-- Current Scout Approach card for Activity webhook reply attribution.

CREATE TABLE IF NOT EXISTS scout_approach_locks (
  user_id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  conversation_id TEXT,
  in_reply_to_id TEXT,
  author TEXT,
  url TEXT,
  text TEXT,
  updated_at TEXT NOT NULL
);
