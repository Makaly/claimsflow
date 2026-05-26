-- Add isOnLeave and relieverId to users.
-- These columns exist in the Prisma schema but were never migrated to the DB,
-- causing every user.findUnique() SELECT to fail with column-not-found → 500.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "isOnLeave"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "relieverId"  TEXT;

-- FK: a user's reliever must also be a user (nullable self-reference).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_relieverId_fkey'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_relieverId_fkey"
      FOREIGN KEY ("relieverId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
