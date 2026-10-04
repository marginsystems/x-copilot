CREATE TABLE IF NOT EXISTS extension_seen_posts (
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  url TEXT NOT NULL,
  page_status_id TEXT,
  seen_at TEXT NOT NULL,
  confirmed_at TEXT,
  unconfirmed_at TEXT,
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_extension_seen_posts_pending
  ON extension_seen_posts (seen_at)
  WHERE confirmed_at IS NULL AND unconfirmed_at IS NULL;
