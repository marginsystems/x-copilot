-- Desk history per user: Interacted, Skip, Not interested, Expired, and the
-- Scout tank. Replaces the shared data/*.json stores. No rows are imported.

CREATE TABLE IF NOT EXISTS desk_interactions (
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  author TEXT NOT NULL,
  author_key TEXT NOT NULL,
  at TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT,
  summary TEXT,
  text TEXT,
  reply_id TEXT,
  reply_url TEXT,
  posted_at TEXT,
  conversation_id TEXT,
  in_reply_to_id TEXT,
  stats TEXT,
  memory_sync_failed INTEGER NOT NULL DEFAULT 0,
  mark_gamification_sync_failed INTEGER NOT NULL DEFAULT 0,
  bonus_gamification_sync_failed INTEGER NOT NULL DEFAULT 0,
  pending_mark_ats TEXT,
  PRIMARY KEY (user_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_desk_interactions_user_at
  ON desk_interactions (user_id, at);

CREATE INDEX IF NOT EXISTS idx_desk_interactions_tenant_at
  ON desk_interactions (tenant_id, at);

CREATE TABLE IF NOT EXISTS desk_skips (
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  author TEXT NOT NULL,
  author_key TEXT NOT NULL,
  at TEXT NOT NULL,
  url TEXT,
  summary TEXT,
  text TEXT,
  PRIMARY KEY (user_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_desk_skips_user_at
  ON desk_skips (user_id, at);

CREATE TABLE IF NOT EXISTS desk_dismissals (
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  author TEXT NOT NULL,
  author_key TEXT NOT NULL,
  at TEXT NOT NULL,
  url TEXT,
  summary TEXT,
  text TEXT,
  reason TEXT,
  conversation_id TEXT,
  in_reply_to_id TEXT,
  PRIMARY KEY (user_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_desk_dismissals_user_at
  ON desk_dismissals (user_id, at);

CREATE TABLE IF NOT EXISTS desk_expired (
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  author TEXT NOT NULL,
  author_key TEXT NOT NULL,
  at TEXT NOT NULL,
  created_at TEXT,
  url TEXT,
  summary TEXT,
  text TEXT,
  PRIMARY KEY (user_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_desk_expired_user_at
  ON desk_expired (user_id, at);

CREATE TABLE IF NOT EXISTS scout_tanks (
  user_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scout_tanks_tenant
  ON scout_tanks (tenant_id);
