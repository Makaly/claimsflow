-- Pre-publish claim drafts: stores extracted field values per session before
-- the user clicks Publish. No FK constraints — provider/claim IDs not required.
-- Rows are soft-deleted (publishedAt set) or hard-deleted after publishing.

CREATE TABLE IF NOT EXISTS "batch_draft_claims" (
  "id"            UUID          NOT NULL DEFAULT gen_random_uuid(),
  "sessionId"     TEXT          NOT NULL,
  "batchId"       TEXT,
  "barcode"       TEXT          NOT NULL,
  "claimNumber"   TEXT,
  "fileName"      TEXT          NOT NULL,
  "fileSize"      INTEGER       NOT NULL DEFAULT 0,
  "fileType"      TEXT,
  "providerName"  TEXT,
  "memberNumber"  TEXT,
  "patientName"   TEXT,
  "patientId"     TEXT,
  "invoiceNumber" TEXT,
  "invoiceDate"   TEXT,
  "invoiceAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "serviceDate"   TEXT,
  "diagnosis"     TEXT,
  "diagnosisCode" TEXT,
  "procedureCode" TEXT,
  "treatment"     TEXT,
  "aiConfidence"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "aiVerified"    BOOLEAN       NOT NULL DEFAULT false,
  "status"        TEXT          NOT NULL DEFAULT 'extracted',
  "pageRange"     TEXT,
  "annotations"   JSONB         NOT NULL DEFAULT '[]',
  "lineItems"     JSONB         NOT NULL DEFAULT '[]',
  "documentPages" JSONB         NOT NULL DEFAULT '[]',
  "publishedAt"   TIMESTAMPTZ,
  "createdAt"     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT "batch_draft_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "batch_draft_claims_barcode_key" ON "batch_draft_claims"("barcode");
CREATE INDEX IF NOT EXISTS "batch_draft_claims_sessionId_idx" ON "batch_draft_claims"("sessionId");
CREATE INDEX IF NOT EXISTS "batch_draft_claims_batchId_idx"   ON "batch_draft_claims"("batchId");
