ALTER TABLE own_posts ADD COLUMN quoted_post_id TEXT;

CREATE TABLE IF NOT EXISTS circle_quote_checks (
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_own_posts_user_kind
  ON own_posts (user_id, kind);
