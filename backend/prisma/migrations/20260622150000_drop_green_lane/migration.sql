-- Drop green-lane auto-approval. Claims must never be auto-approved; the feature
-- (GreenLaneRule model + GreenLaneService/Controller) has been removed from code.
-- Hand-written + idempotent to match the rest of this project: apply via psql,
-- then mark resolved (NOT via `migrate dev`, which would demand a destructive
-- reset on the drift-carrying dev DB).

-- ── Drop the rules table (and its indexes, dropped implicitly) ──
DROP TABLE IF EXISTS "green_lane_rules";

-- ── Remove the master on/off switch row, if it was ever created ──
DELETE FROM "system_config" WHERE "key" = 'green_lane_enabled';
