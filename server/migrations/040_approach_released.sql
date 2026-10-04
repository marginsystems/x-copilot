CREATE TABLE IF NOT EXISTS approach_released (
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  released_at TEXT NOT NULL,
  PRIMARY KEY (user_id, card_id)
);
