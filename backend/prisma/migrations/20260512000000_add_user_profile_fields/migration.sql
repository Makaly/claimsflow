-- Add profile fields and branchId to users table.
-- These columns exist in schema.prisma but were never included in a migration.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "phone"          TEXT,
  ADD COLUMN IF NOT EXISTS "jobTitle"       TEXT,
  ADD COLUMN IF NOT EXISTS "department"     TEXT,
  ADD COLUMN IF NOT EXISTS "location"       TEXT,
  ADD COLUMN IF NOT EXISTS "timezone"       TEXT,
  ADD COLUMN IF NOT EXISTS "language"       TEXT,
  ADD COLUMN IF NOT EXISTS "bio"            TEXT,
  ADD COLUMN IF NOT EXISTS "avatarUrl"      TEXT,
  ADD COLUMN IF NOT EXISTS "savedSignatures" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "branchId"       TEXT;

CREATE INDEX IF NOT EXISTS "users_branchId_idx" ON "users"("branchId");
