-- PR4: per-document approval workflow + versioning on onboarding documents.
--
-- Each uploaded file is now individually reviewable. When an admin rejects a
-- file, the provider can upload a corrected version which is linked via
-- supersedesId and the old row is kept (isLatest=false) for the audit trail.

ALTER TABLE "provider_onboarding_documents"
  ADD COLUMN IF NOT EXISTS "status"        TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "reviewedBy"    TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewComment" TEXT,
  ADD COLUMN IF NOT EXISTS "version"       INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "supersedesId"  TEXT,
  ADD COLUMN IF NOT EXISTS "isLatest"      BOOLEAN NOT NULL DEFAULT true;

-- FK on supersedesId — cascade NULL if a parent version is hard-deleted.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'provider_onboarding_documents_supersedesId_fkey'
  ) THEN
    ALTER TABLE "provider_onboarding_documents"
      ADD CONSTRAINT "provider_onboarding_documents_supersedesId_fkey"
      FOREIGN KEY ("supersedesId") REFERENCES "provider_onboarding_documents"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: any document uploaded before PR4 is treated as approved + v1 +
-- latest, so existing provider packets continue to work without admin action.
UPDATE "provider_onboarding_documents"
   SET "status"   = 'approved',
       "version"  = 1,
       "isLatest" = true
 WHERE "status"   IS NULL OR "status" = 'pending';

CREATE INDEX IF NOT EXISTS "provider_onboarding_documents_providerId_isLatest_idx"
  ON "provider_onboarding_documents"("providerId", "isLatest");
CREATE INDEX IF NOT EXISTS "provider_onboarding_documents_status_idx"
  ON "provider_onboarding_documents"("status");
