-- Created + last-seen IP/UA sidecar. Never store session tokens or hashes here.
-- Applied by server/src/db.ts at sidecar boot.

CREATE TABLE IF NOT EXISTS session_meta (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_ip TEXT,
  created_user_agent TEXT,
  last_seen_at TEXT NOT NULL,
  last_seen_ip TEXT,
  last_seen_user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_session_meta_user
  ON session_meta (user_id);
