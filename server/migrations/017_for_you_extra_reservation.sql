-- In-flight extra reservations expire if the process dies mid-call; delivered
-- batches are permanent ledger entries for the UTC-day cap.

ALTER TABLE for_you_extras ADD COLUMN expires_at TEXT;
