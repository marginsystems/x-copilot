-- Ingested X posts from Activity API post.create + watch list for auto-mark.

CREATE TABLE IF NOT EXISTS own_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  x_user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT,
  posted_at TEXT NOT NULL,
  in_reply_to_id TEXT,
  in_reply_to_user_id TEXT,
  conversation_id TEXT,
  url TEXT,
  t0_views INTEGER,
  t0_likes INTEGER,
  t0_replies INTEGER,
  t0_retweets INTEGER,
  t0_bookmarks INTEGER,
  t0_at TEXT,
  t1h_views INTEGER,
  t1h_likes INTEGER,
  t1h_replies INTEGER,
  t1h_retweets INTEGER,
  t1h_bookmarks INTEGER,
  t1h_at TEXT,
  t24h_views INTEGER,
  t24h_likes INTEGER,
  t24h_replies INTEGER,
  t24h_retweets INTEGER,
  t24h_bookmarks INTEGER,
  t24h_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_own_posts_user_posted
  ON own_posts (user_id, posted_at DESC);

CREATE INDEX IF NOT EXISTS idx_own_posts_tenant_posted
  ON own_posts (tenant_id, posted_at DESC);

CREATE INDEX IF NOT EXISTS idx_own_posts_due_snapshot
  ON own_posts (posted_at DESC)
  WHERE t1h_at IS NULL OR t24h_at IS NULL;

CREATE TABLE IF NOT EXISTS activity_subscriptions (
  user_id TEXT PRIMARY KEY,
  x_user_id TEXT NOT NULL,
  subscription_id TEXT,
  webhook_id TEXT,
  paused_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_subs_x_user
  ON activity_subscriptions (x_user_id);

CREATE TABLE IF NOT EXISTS activity_event_ids (
  event_uuid TEXT PRIMARY KEY,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watched_threads (
  user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  author TEXT,
  url TEXT,
  text TEXT,
  conversation_id TEXT,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (user_id, thread_id)
);
