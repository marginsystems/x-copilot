-- Mark paid Approach extras so the daily pass does not expire them early.

ALTER TABLE for_you_suggestions
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'daily';

CREATE INDEX IF NOT EXISTS idx_for_you_suggestions_origin
  ON for_you_suggestions (user_id, status, origin);
