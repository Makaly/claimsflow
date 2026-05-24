-- V2 completion: add missing fields and models surfaced during TypeScript compilation

-- ClaimLabel: add isFraud flag, relation to Claim (drop @unique on claimId to allow back-relation in Prisma but keep the constraint), add claim FK
ALTER TABLE "claim_labels" ADD COLUMN IF NOT EXISTS "isFraud" BOOLEAN NOT NULL DEFAULT false;
-- unique constraint on claimId already exists from original migration
ALTER TABLE "claim_labels" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ;
UPDATE "claim_labels" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "claim_labels" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "claim_labels" ALTER COLUMN "updatedAt" SET DEFAULT now();

-- Claim: add isLabelled flag
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "isLabelled" BOOLEAN NOT NULL DEFAULT false;

-- Payout transactions table (B1: mobile money)
CREATE TABLE IF NOT EXISTS "payout_transactions" (
    "id"                        TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    "adviceId"                  TEXT        NOT NULL,
    "carrier"                   TEXT        NOT NULL,
    "msisdn"                    TEXT,
    "amount"                    DOUBLE PRECISION NOT NULL,
    "status"                    TEXT        NOT NULL DEFAULT 'pending',
    "originatorConversationId"  TEXT,
    "carrierRef"                TEXT,
    "lastError"                 TEXT,
    "attempts"                  INTEGER     NOT NULL DEFAULT 0,
    "createdAt"                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "payout_transactions_adviceId_idx" ON "payout_transactions"("adviceId");
CREATE INDEX IF NOT EXISTS "payout_transactions_status_idx"   ON "payout_transactions"("status");
CREATE INDEX IF NOT EXISTS "payout_transactions_createdAt_idx" ON "payout_transactions"("createdAt");
