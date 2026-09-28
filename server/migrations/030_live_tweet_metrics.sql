CREATE TABLE IF NOT EXISTS live_tweet_metrics (
  tweet_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  metrics_json TEXT,
  fetched_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_live_tweet_metrics_fetched_at
  ON live_tweet_metrics (fetched_at);
