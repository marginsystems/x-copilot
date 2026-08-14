-- Per-user tenant + Stripe billing (SQLite now; keep portable for Postgres).
-- One desk (tenant) per user. Credits meter X post reads on that tenant.

ALTER TABLE users ADD COLUMN tenant_id TEXT REFERENCES tenants(id);

CREATE TABLE IF NOT EXISTS user_billing (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  plan_key TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  stripe_last_event_created INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_billing_tenant ON user_billing (tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_billing_stripe_sub
  ON user_billing (stripe_subscription_id);
