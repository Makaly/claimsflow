-- PR1: Provider self-registration + admin approval with per-page review tracking.
--
-- This migration adds:
--   1. users.emailVerifiedAt          — null until the user confirms via OTP
--   2. email_verification_tokens      — one-time OTP store (hashed)
--   3. providers.approvalComment      — free-text note captured at approve/reject
--   4. provider_onboarding_documents.pageCount — total pages, used by the
--      "admin must view every page" gate before approval

-- 1. users.emailVerifiedAt
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);

-- Backfill: every user that existed before PR1 is treated as verified.
-- Without this, login would suddenly start failing for every pre-existing
-- account once the new "email_not_verified" guard ships.
UPDATE "users"
   SET "emailVerifiedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP)
 WHERE "emailVerifiedAt" IS NULL;

-- 2. email_verification_tokens
CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "email"      TEXT NOT NULL,
  "codeHash"   TEXT NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "attempts"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_verification_tokens_userId_idx"
  ON "email_verification_tokens"("userId");
CREATE INDEX IF NOT EXISTS "email_verification_tokens_email_idx"
  ON "email_verification_tokens"("email");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_verification_tokens_userId_fkey'
  ) THEN
    ALTER TABLE "email_verification_tokens"
      ADD CONSTRAINT "email_verification_tokens_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. providers.approvalComment
ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "approvalComment" TEXT;

-- 4. provider_onboarding_documents.pageCount
ALTER TABLE "provider_onboarding_documents"
  ADD COLUMN IF NOT EXISTS "pageCount" INTEGER;
