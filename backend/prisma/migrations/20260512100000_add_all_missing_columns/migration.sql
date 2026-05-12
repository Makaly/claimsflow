-- Comprehensive catch-up migration: columns and tables present in schema.prisma
-- but missing from earlier migrations. All statements use IF NOT EXISTS / IF
-- EXISTS guards so the migration is idempotent and safe to re-run.

-- ── providers ────────────────────────────────────────────────────────────────
ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "invoiceUploaderId"      TEXT,
  ADD COLUMN IF NOT EXISTS "companyStructure"       TEXT,
  ADD COLUMN IF NOT EXISTS "registrationNumber"     TEXT,
  ADD COLUMN IF NOT EXISTS "kraPin"                 TEXT,
  ADD COLUMN IF NOT EXISTS "incorporationDate"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "numberOfPartners"       INTEGER,
  ADD COLUMN IF NOT EXISTS "ownerName"              TEXT,
  ADD COLUMN IF NOT EXISTS "ownerIdNumber"          TEXT,
  ADD COLUMN IF NOT EXISTS "proofDocumentPath"      TEXT,
  ADD COLUMN IF NOT EXISTS "proofDocumentName"      TEXT;

-- ── branches ─────────────────────────────────────────────────────────────────
ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "invoiceUploaderId" TEXT,
  ADD COLUMN IF NOT EXISTS "branchManagerId"   TEXT;

-- ── claims ───────────────────────────────────────────────────────────────────
ALTER TABLE "claims"
  ADD COLUMN IF NOT EXISTS "uploadedBy"    TEXT,
  ADD COLUMN IF NOT EXISTS "fraudSignals"  JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "annotations"   JSONB NOT NULL DEFAULT '[]';

-- ── documents ────────────────────────────────────────────────────────────────
ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "providerId" TEXT;

CREATE INDEX IF NOT EXISTS "documents_providerId_idx" ON "documents"("providerId");

-- ── ocr_extractions ──────────────────────────────────────────────────────────
ALTER TABLE "ocr_extractions"
  ADD COLUMN IF NOT EXISTS "patientId" TEXT;

-- ── document_zones (extra fields added after the original create) ─────────────
ALTER TABLE "document_zones"
  ADD COLUMN IF NOT EXISTS "searchPhrase"    TEXT,
  ADD COLUMN IF NOT EXISTS "pageNumber"      INTEGER,
  ADD COLUMN IF NOT EXISTS "claimField"      TEXT,
  ADD COLUMN IF NOT EXISTS "locationContext" TEXT,
  ADD COLUMN IF NOT EXISTS "parentZoneId"    TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updatedByName"   TEXT;

CREATE INDEX IF NOT EXISTS "document_zones_parentZoneId_idx" ON "document_zones"("parentZoneId");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_zones_parentZoneId_fkey'
  ) THEN
    ALTER TABLE "document_zones"
      ADD CONSTRAINT "document_zones_parentZoneId_fkey"
        FOREIGN KEY ("parentZoneId") REFERENCES "document_zones"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── unknown_documents (table entirely missing from all migrations) ────────────
CREATE TABLE IF NOT EXISTS "unknown_documents" (
    "id"              TEXT NOT NULL,
    "filePath"        TEXT NOT NULL,
    "fileName"        TEXT NOT NULL,
    "mimeType"        TEXT NOT NULL DEFAULT 'application/pdf',
    "guessedType"     TEXT,
    "guessedProvider" TEXT,
    "rawExtract"      JSONB,
    "status"          TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy"      TEXT,
    "reviewedAt"      TIMESTAMP(3),
    "notes"           TEXT,
    "claimId"         TEXT,
    "uploadedBy"      TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unknown_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "unknown_documents_status_idx"    ON "unknown_documents"("status");
CREATE INDEX IF NOT EXISTS "unknown_documents_createdAt_idx" ON "unknown_documents"("createdAt");

-- ── claim_emails (table entirely missing from all migrations) ─────────────────
CREATE TABLE IF NOT EXISTS "claim_emails" (
    "id"          TEXT NOT NULL,
    "claimId"     TEXT NOT NULL,
    "sentBy"      TEXT,
    "sentByName"  TEXT,
    "sentTo"      TEXT NOT NULL,
    "cc"          TEXT,
    "subject"     TEXT NOT NULL,
    "body"        TEXT NOT NULL,
    "htmlBody"    TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "sentAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status"      TEXT NOT NULL DEFAULT 'sent',

    CONSTRAINT "claim_emails_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "claim_emails_claimId_idx" ON "claim_emails"("claimId");
CREATE INDEX IF NOT EXISTS "claim_emails_sentAt_idx"  ON "claim_emails"("sentAt");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claim_emails_claimId_fkey'
  ) THEN
    ALTER TABLE "claim_emails"
      ADD CONSTRAINT "claim_emails_claimId_fkey"
        FOREIGN KEY ("claimId") REFERENCES "claims"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_providerId_fkey'
  ) THEN
    ALTER TABLE "documents"
      ADD CONSTRAINT "documents_providerId_fkey"
        FOREIGN KEY ("providerId") REFERENCES "providers"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
