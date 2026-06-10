-- Diagnosis-vs-billing audit cache (per-claim result, served without re-calling the AI)
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "billingAuditStatus"  TEXT;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "billingAuditScore"   DOUBLE PRECISION;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "billingAuditSummary" TEXT;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "billingAuditItems"   JSONB;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "billingAuditAt"      TIMESTAMP(3);

-- Per-field source annotations (Kodak-style overlay) on OCR extractions
ALTER TABLE "ocr_extractions" ADD COLUMN IF NOT EXISTS "fieldAnnotations" JSONB;

-- OCR text + field-source data on draft claims so the billing audit and the
-- document overlay survive a draft reload
ALTER TABLE "batch_draft_claims" ADD COLUMN IF NOT EXISTS "rawText"          TEXT;
ALTER TABLE "batch_draft_claims" ADD COLUMN IF NOT EXISTS "fieldAnnotations" JSONB;
ALTER TABLE "batch_draft_claims" ADD COLUMN IF NOT EXISTS "fieldConfidences" JSONB;
