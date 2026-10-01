ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'browser'
  CHECK (kind IN ('browser', 'extension'));
