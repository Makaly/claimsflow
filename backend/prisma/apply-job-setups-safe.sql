-- Idempotent apply of the job_setups feature for an out-of-sync dev DB.
-- Safe to re-run. The canonical migration lives in migrations/20260530000001_job_setups.

CREATE TABLE IF NOT EXISTS "job_setups" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL UNIQUE,
    "description" TEXT,
    "documentType" TEXT,
    "templateId" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "learningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoPopulateFromHistory" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "job_setups_isActive_idx" ON "job_setups"("isActive");

CREATE TABLE IF NOT EXISTS "job_setup_fields" (
    "id" TEXT PRIMARY KEY,
    "jobSetupId" TEXT NOT NULL REFERENCES "job_setups"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "placeholder" TEXT,
    "defaultValue" TEXT,
    "options" JSONB NOT NULL DEFAULT '[]',
    "validationRegex" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "extractionKey" TEXT,
    "lookupSourceId" TEXT,
    "lookupKeyField" TEXT,
    "lookupReturn" TEXT,
    "autoPopulate" BOOLEAN NOT NULL DEFAULT false,
    "isKey" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "job_setup_fields_jobSetupId_key_key" ON "job_setup_fields"("jobSetupId", "key");
CREATE INDEX IF NOT EXISTS "job_setup_fields_jobSetupId_idx" ON "job_setup_fields"("jobSetupId");

CREATE TABLE IF NOT EXISTS "lookup_sources" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL UNIQUE,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "fileName" TEXT,
    "filePath" TEXT,
    "keyColumn" TEXT,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "lookup_sources_type_idx" ON "lookup_sources"("type");
CREATE INDEX IF NOT EXISTS "lookup_sources_isActive_idx" ON "lookup_sources"("isActive");

CREATE TABLE IF NOT EXISTS "lookup_rows" (
    "id" TEXT PRIMARY KEY,
    "sourceId" TEXT NOT NULL REFERENCES "lookup_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "keyValue" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "lookup_rows_sourceId_keyValue_idx" ON "lookup_rows"("sourceId", "keyValue");

CREATE TABLE IF NOT EXISTS "job_setup_knowledge" (
    "id" TEXT PRIMARY KEY,
    "jobSetupId" TEXT NOT NULL REFERENCES "job_setups"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "fieldKey" TEXT NOT NULL,
    "valueNorm" TEXT NOT NULL,
    "valueDisplay" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "job_setup_knowledge_jobSetupId_fieldKey_valueNorm_key" ON "job_setup_knowledge"("jobSetupId", "fieldKey", "valueNorm");
CREATE INDEX IF NOT EXISTS "job_setup_knowledge_jobSetupId_fieldKey_idx" ON "job_setup_knowledge"("jobSetupId", "fieldKey");

-- Columns on existing tables (guarded; skip whichever base table is absent).
ALTER TABLE "batch_submissions" ADD COLUMN IF NOT EXISTS "jobSetupId" TEXT;
CREATE INDEX IF NOT EXISTS "batch_submissions_jobSetupId_idx" ON "batch_submissions"("jobSetupId");

ALTER TABLE "ocr_extractions" ADD COLUMN IF NOT EXISTS "jobSetupId" TEXT;
ALTER TABLE "ocr_extractions" ADD COLUMN IF NOT EXISTS "customFields" JSONB DEFAULT '{}';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='batch_draft_claims') THEN
    ALTER TABLE "batch_draft_claims" ADD COLUMN IF NOT EXISTS "jobSetupId" TEXT;
    ALTER TABLE "batch_draft_claims" ADD COLUMN IF NOT EXISTS "customFields" JSONB NOT NULL DEFAULT '{}';
    CREATE INDEX IF NOT EXISTS "batch_draft_claims_jobSetupId_idx" ON "batch_draft_claims"("jobSetupId");
  END IF;
END $$;
