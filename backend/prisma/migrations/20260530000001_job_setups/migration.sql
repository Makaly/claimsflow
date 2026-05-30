-- Job Setups: per-document-type indexing profiles with isolated learning
-- and pluggable reference-data lookups.

-- ── job_setups ───────────────────────────────────────────────────────────────
CREATE TABLE "job_setups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "job_setups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "job_setups_slug_key" ON "job_setups"("slug");
CREATE INDEX "job_setups_slug_idx" ON "job_setups"("slug");
CREATE INDEX "job_setups_isActive_idx" ON "job_setups"("isActive");

-- ── job_setup_fields ─────────────────────────────────────────────────────────
CREATE TABLE "job_setup_fields" (
    "id" TEXT NOT NULL,
    "jobSetupId" TEXT NOT NULL,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "job_setup_fields_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "job_setup_fields_jobSetupId_key_key" ON "job_setup_fields"("jobSetupId", "key");
CREATE INDEX "job_setup_fields_jobSetupId_idx" ON "job_setup_fields"("jobSetupId");
CREATE INDEX "job_setup_fields_lookupSourceId_idx" ON "job_setup_fields"("lookupSourceId");
ALTER TABLE "job_setup_fields" ADD CONSTRAINT "job_setup_fields_jobSetupId_fkey"
    FOREIGN KEY ("jobSetupId") REFERENCES "job_setups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── lookup_sources ───────────────────────────────────────────────────────────
CREATE TABLE "lookup_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lookup_sources_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lookup_sources_slug_key" ON "lookup_sources"("slug");
CREATE INDEX "lookup_sources_slug_idx" ON "lookup_sources"("slug");
CREATE INDEX "lookup_sources_type_idx" ON "lookup_sources"("type");
CREATE INDEX "lookup_sources_isActive_idx" ON "lookup_sources"("isActive");

-- ── lookup_rows ──────────────────────────────────────────────────────────────
CREATE TABLE "lookup_rows" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "keyValue" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lookup_rows_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lookup_rows_sourceId_keyValue_idx" ON "lookup_rows"("sourceId", "keyValue");
ALTER TABLE "lookup_rows" ADD CONSTRAINT "lookup_rows_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "lookup_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── job_setup_knowledge (per-setup isolated learning) ────────────────────────
CREATE TABLE "job_setup_knowledge" (
    "id" TEXT NOT NULL,
    "jobSetupId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "valueNorm" TEXT NOT NULL,
    "valueDisplay" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_setup_knowledge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "job_setup_knowledge_jobSetupId_fieldKey_valueNorm_key" ON "job_setup_knowledge"("jobSetupId", "fieldKey", "valueNorm");
CREATE INDEX "job_setup_knowledge_jobSetupId_fieldKey_idx" ON "job_setup_knowledge"("jobSetupId", "fieldKey");
ALTER TABLE "job_setup_knowledge" ADD CONSTRAINT "job_setup_knowledge_jobSetupId_fkey"
    FOREIGN KEY ("jobSetupId") REFERENCES "job_setups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── jobSetupId columns on existing tables ────────────────────────────────────
ALTER TABLE "batch_submissions" ADD COLUMN "jobSetupId" TEXT;
CREATE INDEX "batch_submissions_jobSetupId_idx" ON "batch_submissions"("jobSetupId");

ALTER TABLE "batch_draft_claims" ADD COLUMN "jobSetupId" TEXT;
ALTER TABLE "batch_draft_claims" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '{}';
CREATE INDEX "batch_draft_claims_jobSetupId_idx" ON "batch_draft_claims"("jobSetupId");

ALTER TABLE "ocr_extractions" ADD COLUMN "jobSetupId" TEXT;
ALTER TABLE "ocr_extractions" ADD COLUMN "customFields" JSONB DEFAULT '{}';
