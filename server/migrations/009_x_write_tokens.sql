-- Persist X OAuth 1.0a user tokens so the desk can POST /2/tweets as them.
-- NULL until they re-link X after the app is set to Read and write.

ALTER TABLE oauth_accounts ADD COLUMN access_token TEXT;
ALTER TABLE oauth_accounts ADD COLUMN access_token_secret TEXT;
ALTER TABLE oauth_accounts ADD COLUMN write_granted_at TEXT;

CREATE TABLE IF NOT EXISTS x_desk_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tweet_id TEXT NOT NULL,
  in_reply_to_id TEXT NOT NULL,
  thread_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_x_desk_posts_user_created
  ON x_desk_posts (user_id, created_at);
