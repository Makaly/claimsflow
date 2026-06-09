-- Add per-page document classification to OcrExtraction so published claims
-- retain the document categories (Invoice / Authorization Letter / Discharge
-- Summary, …) the classifier produced — mirrors BatchDraftClaim.documentPages.
ALTER TABLE "ocr_extractions" ADD COLUMN IF NOT EXISTS "documentPages" JSONB DEFAULT '[]'::jsonb;
