-- UTC-day ledger for credit-backed Approach extra batches.

CREATE TABLE IF NOT EXISTS for_you_extras (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_for_you_extras_user_at
  ON for_you_extras (user_id, at);
