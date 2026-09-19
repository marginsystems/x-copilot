-- X Pay Per Use dedupes the same post for one UTC day. Charge a tenant
-- once per post id per UTC day so Scout overlapping searches match X.
CREATE TABLE IF NOT EXISTS usage_post_reads (
  tenant_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  PRIMARY KEY (tenant_id, post_id, day_utc)
);

CREATE INDEX IF NOT EXISTS idx_usage_post_reads_tenant_day
  ON usage_post_reads (tenant_id, day_utc);
