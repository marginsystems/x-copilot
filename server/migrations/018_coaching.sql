-- Next recommended action cache + UTC daily missions.
-- Next-action is invalidated by inputs_hash (marks / desk posts / takeoffs).
-- Mission progress is computed from existing stores; claimed_at gates XP.

CREATE TABLE IF NOT EXISTS next_action_cache (
  user_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  inputs_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_missions (
  user_id TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  target INTEGER NOT NULL,
  xp_reward INTEGER NOT NULL,
  claimed_at TEXT,
  PRIMARY KEY (user_id, day_utc, mission_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_missions_user_day
  ON daily_missions (user_id, day_utc);
