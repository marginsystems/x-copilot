-- First-run setup: chosen agenda + completion timestamp.
-- Existing users are marked complete so current operators skip the wizard.

ALTER TABLE users ADD COLUMN onboarding_completed_at TEXT;
ALTER TABLE users ADD COLUMN agenda TEXT;

UPDATE users
SET onboarding_completed_at = COALESCE(last_login_at, created_at)
WHERE onboarding_completed_at IS NULL;
