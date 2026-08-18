-- Complimentary plan grants (no Stripe subscription).
-- NULL grant_plan_key means no grant. Stripe still wins when live.

ALTER TABLE user_billing ADD COLUMN grant_plan_key TEXT;
ALTER TABLE user_billing ADD COLUMN grant_created_at TEXT;
ALTER TABLE user_billing ADD COLUMN grant_created_by TEXT;
