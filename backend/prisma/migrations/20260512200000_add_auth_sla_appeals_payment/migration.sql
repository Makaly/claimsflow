-- G02/G03: Password reset fields on users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordResetToken" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordResetExpiry" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "users_passwordResetToken_idx" ON "users"("passwordResetToken");

-- G05: SLA fields on claims
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "slaBreached" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "slaBreachedAt" TIMESTAMP(3);
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "slaDeadline" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "claims_slaBreached_idx" ON "claims"("slaBreached");

-- G04: Eligibility fields on claims
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "eligibilityStatus" TEXT;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "eligibilityCheckedAt" TIMESTAMP(3);
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "eligibilityNotes" TEXT;

-- G08: Appeals table
CREATE TABLE IF NOT EXISTS "appeals" (
  "id" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "filedBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "additionalNotes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "adjudicatedBy" TEXT,
  "adjudicatedAt" TIMESTAMP(3),
  "outcome" TEXT,
  "outcomeNotes" TEXT,
  "documents" JSONB DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "appeals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appeals_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE RESTRICT,
  CONSTRAINT "appeals_filedBy_fkey" FOREIGN KEY ("filedBy") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "appeals_claimId_idx" ON "appeals"("claimId");
CREATE INDEX IF NOT EXISTS "appeals_providerId_idx" ON "appeals"("providerId");
CREATE INDEX IF NOT EXISTS "appeals_status_idx" ON "appeals"("status");

-- Users <-> Appeals relations
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "appealsAdjudicatedId" TEXT;

-- G01: Payment advices table
CREATE TABLE IF NOT EXISTS "payment_advices" (
  "id" TEXT NOT NULL,
  "adviceNumber" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "claimIds" JSONB NOT NULL,
  "totalAmount" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "generatedBy" TEXT,
  "confirmedBy" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "paymentReference" TEXT,
  "paymentDate" TIMESTAMP(3),
  "bankDetails" JSONB,
  "notes" TEXT,
  "exportedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_advices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_advices_adviceNumber_key" UNIQUE ("adviceNumber")
);
CREATE INDEX IF NOT EXISTS "payment_advices_providerId_idx" ON "payment_advices"("providerId");
CREATE INDEX IF NOT EXISTS "payment_advices_status_idx" ON "payment_advices"("status");
