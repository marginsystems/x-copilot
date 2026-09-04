-- Allow cleared subscriptions to retain their row without an X account.

ALTER TABLE activity_subscriptions
  RENAME TO activity_subscriptions_old;

CREATE TABLE activity_subscriptions (
  user_id TEXT PRIMARY KEY,
  x_user_id TEXT,
  subscription_id TEXT,
  webhook_id TEXT,
  paused_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delete_subscription_id TEXT
);

INSERT INTO activity_subscriptions (
  user_id, x_user_id, subscription_id, webhook_id, paused_until,
  created_at, updated_at, delete_subscription_id
)
SELECT
  user_id, x_user_id, subscription_id, webhook_id, paused_until,
  created_at, updated_at, delete_subscription_id
FROM activity_subscriptions_old;

DROP TABLE activity_subscriptions_old;

CREATE INDEX idx_activity_subs_x_user
  ON activity_subscriptions (x_user_id);
