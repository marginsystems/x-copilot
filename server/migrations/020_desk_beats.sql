-- One finite desk sequence per user and UTC day.

CREATE TABLE IF NOT EXISTS desk_beats (
  user_id TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  scout_reply_done INTEGER NOT NULL DEFAULT 0
    CHECK (scout_reply_done IN (0, 1)),
  organic_reply_done INTEGER NOT NULL DEFAULT 0
    CHECK (organic_reply_done IN (0, 1)),
  fork_choice TEXT
    CHECK (fork_choice IS NULL OR fork_choice IN ('original', 'reply')),
  fork_done INTEGER NOT NULL DEFAULT 0
    CHECK (fork_done IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, day_utc)
);
