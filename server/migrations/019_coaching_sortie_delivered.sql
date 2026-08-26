-- Track delivered (non-wasted) takeoffs for the daily mission metric.
-- The daily sortie cap still counts every non-refunded row; `delivered` lets
-- the takeoff mission count only runs that landed, never in-flight or refunded
-- flights that claimed XP and were then deleted as wasted.

ALTER TABLE scout_sorties ADD COLUMN delivered INTEGER NOT NULL DEFAULT 0;
