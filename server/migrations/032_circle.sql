CREATE TABLE IF NOT EXISTS x_profiles (
  author_key TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS circle_links (
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  author_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reply', 'quote')),
  at TEXT NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_circle_links_user_author
  ON circle_links (user_id, author_key);
