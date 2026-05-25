-- v2-T4.5: Activity-log monthly RANGE partitioning
--
-- IMPORTANT: Converting an existing non-partitioned table to RANGE-partitioned
-- requires a full table rebuild and is best done as a zero-downtime migration
-- using the steps below. This script is idempotent when run against a fresh DB
-- (e.g. staging / test). For production, run during a maintenance window or
-- use pg_partman's background migration tool.
--
-- Strategy (production):
--   1. CREATE TABLE activity_logs_partitioned (LIKE activity_logs) PARTITION BY RANGE (createdAt)
--   2. Create initial month partitions
--   3. Attach stored procedure for auto-creating next-month partitions
--   4. Background-copy rows: INSERT INTO activity_logs_partitioned SELECT * FROM activity_logs
--   5. Swap table names atomically inside a transaction
--
-- This migration implements steps 1–3 only. Steps 4–5 are manual runbook tasks.

-- Step 1: Create the partitioned parent table.
-- INCLUDING ALL cannot be used here because PostgreSQL requires every unique
-- constraint (including PRIMARY KEY) on a partitioned table to include all
-- partition key columns. We copy only DEFAULTS and add a composite PK manually.
CREATE TABLE IF NOT EXISTS activity_logs_partitioned (
  LIKE activity_logs INCLUDING DEFAULTS INCLUDING GENERATED
) PARTITION BY RANGE ("createdAt");

-- Composite PK: id identifies the row; createdAt satisfies the partition key requirement.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activity_logs_partitioned_pkey'
  ) THEN
    ALTER TABLE activity_logs_partitioned ADD PRIMARY KEY ("id", "createdAt");
  END IF;
END $$;

-- Step 2: Create initial partitions (current month + 2 future months)
DO $$
DECLARE
  m DATE;
  part_name TEXT;
  from_ts TIMESTAMPTZ;
  to_ts   TIMESTAMPTZ;
BEGIN
  FOR i IN 0..2 LOOP
    m := date_trunc('month', NOW()) + (i || ' months')::interval;
    part_name := 'activity_logs_' || to_char(m, 'YYYY_MM');
    from_ts   := m;
    to_ts     := m + interval '1 month';
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF activity_logs_partitioned FOR VALUES FROM (%L) TO (%L)',
        part_name, from_ts, to_ts
      );
    END IF;
  END LOOP;
END;
$$;

-- Step 3: Stored procedure to create next-month partition
-- Call this via a pg_cron job or the NestJS scheduler at the start of each month.
CREATE OR REPLACE FUNCTION create_next_activity_log_partition()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  next_month DATE;
  part_name  TEXT;
  from_ts    TIMESTAMPTZ;
  to_ts      TIMESTAMPTZ;
BEGIN
  next_month := date_trunc('month', NOW() + interval '1 month');
  part_name  := 'activity_logs_' || to_char(next_month, 'YYYY_MM');
  from_ts    := next_month;
  to_ts      := next_month + interval '1 month';
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF activity_logs_partitioned FOR VALUES FROM (%L) TO (%L)',
      part_name, from_ts, to_ts
    );
    RAISE NOTICE 'Created partition %', part_name;
  ELSE
    RAISE NOTICE 'Partition % already exists', part_name;
  END IF;
END;
$$;

-- NOTE: The production swap (steps 4-5) is a manual runbook operation.
-- See docs/architecture/activity-log-partitioning.md for the full procedure.
