-- Chosen vision model id for a batch's extraction (null = server default).
ALTER TABLE "batch_submissions" ADD COLUMN IF NOT EXISTS "extractionModel" TEXT;
