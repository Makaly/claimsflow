-- PR2: provider-admin approval workflow for users registered under a provider.
--
-- A normal user who registers under an existing approved provider sits in
-- "pending" state until that provider's admin approves them. NULL means the
-- column doesn't apply (admin, claims_officer, finance, etc. — internal staff).

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "providerApprovalStatus"  TEXT,
  ADD COLUMN IF NOT EXISTS "providerApprovedBy"      TEXT,
  ADD COLUMN IF NOT EXISTS "providerApprovedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "providerApprovalComment" TEXT,
  ADD COLUMN IF NOT EXISTS "providerRejectionReason" TEXT;

-- Backfill: every existing provider_user / provider_admin is treated as
-- approved so they continue to log in after this migration deploys.
UPDATE "users"
   SET "providerApprovalStatus" = 'approved',
       "providerApprovedAt"     = COALESCE("createdAt", CURRENT_TIMESTAMP)
 WHERE "role" IN ('provider_admin', 'provider_user')
   AND "providerApprovalStatus" IS NULL;

CREATE INDEX IF NOT EXISTS "users_providerApprovalStatus_idx"
  ON "users"("providerApprovalStatus");
CREATE INDEX IF NOT EXISTS "users_providerId_providerApprovalStatus_idx"
  ON "users"("providerId", "providerApprovalStatus");
