-- Explicit opt-in for the daily Approach digest. Off by default.

ALTER TABLE users ADD COLUMN digest_email_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN digest_email_opt_in_at TEXT;
ALTER TABLE users ADD COLUMN digest_email_sent_at TEXT;
