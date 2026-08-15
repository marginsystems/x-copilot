-- Voice profiles: learned public-reply style per user (their replies only).
-- No X user tokens, no other people's feeds, no model training.

CREATE TABLE IF NOT EXISTS voice_profiles (
  user_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  x_username TEXT,
  x_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'empty',
  reply_count INTEGER NOT NULL DEFAULT 0,
  conversation_count INTEGER NOT NULL DEFAULT 0,
  card_json TEXT,
  card_model TEXT,
  card_updated_at TEXT,
  since_id TEXT,
  last_pull_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_replies (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  conversation_id TEXT,
  in_reply_to_id TEXT,
  text TEXT NOT NULL,
  posted_at TEXT,
  source TEXT NOT NULL DEFAULT 'api',
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_voice_replies_user_posted
  ON voice_replies (user_id, posted_at DESC);

CREATE TABLE IF NOT EXISTS voice_suggests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  thread_id TEXT,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voice_suggests_user_at
  ON voice_suggests (user_id, at);
