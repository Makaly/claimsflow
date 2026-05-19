-- B3: Bank statement lines for reconciliation
CREATE TABLE "bank_statement_lines" (
    "id"             TEXT NOT NULL,
    "uploadId"       TEXT NOT NULL,
    "format"         TEXT NOT NULL,
    "reference"      TEXT,
    "amount"         DOUBLE PRECISION NOT NULL,
    "currency"       TEXT NOT NULL DEFAULT 'KES',
    "valueDate"      TIMESTAMP(3) NOT NULL,
    "description"    TEXT,
    "status"         TEXT NOT NULL DEFAULT 'unreconciled',
    "matchedClaimId" TEXT,
    "matchedAt"      TIMESTAMP(3),
    "matchedBy"      TEXT,
    "writeOffReason" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bank_statement_lines_uploadId_idx"   ON "bank_statement_lines"("uploadId");
CREATE INDEX "bank_statement_lines_status_idx"     ON "bank_statement_lines"("status");
CREATE INDEX "bank_statement_lines_reference_idx"  ON "bank_statement_lines"("reference");
CREATE INDEX "bank_statement_lines_valueDate_idx"  ON "bank_statement_lines"("valueDate");
