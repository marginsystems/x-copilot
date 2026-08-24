-- Stamp every card rewrite attempt (success or failure) so the hourly
-- refresh gate caps card generation at once per UTC day even when the LLM
-- fails. card_updated_at keeps meaning the last successful write.
ALTER TABLE voice_profiles ADD COLUMN card_attempt_at TEXT;
