-- Once-per-UTC-day desk analytics note. One row per user per day; the
-- stats worker writes it after the hourly pass, the API only reads.

CREATE TABLE IF NOT EXISTS analytics_insights (
  user_id TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  headline TEXT NOT NULL,
  bullets_json TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, day_utc)
);
