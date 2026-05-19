-- B2: GL account mappings and posting log
CREATE TABLE "gl_account_mappings" (
    "id"          TEXT NOT NULL,
    "claimType"   TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "description" TEXT,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "updatedBy"   TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gl_account_mappings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gl_account_mappings_claimType_key" ON "gl_account_mappings"("claimType");
CREATE INDEX "gl_account_mappings_claimType_idx" ON "gl_account_mappings"("claimType");

CREATE TABLE "gl_posting_logs" (
    "id"          TEXT NOT NULL,
    "batchKey"    TEXT NOT NULL,
    "postedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimCount"  INTEGER NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "target"      TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'success',
    "errorMsg"    TEXT,
    "outputPath"  TEXT,

    CONSTRAINT "gl_posting_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gl_posting_logs_batchKey_key" ON "gl_posting_logs"("batchKey");
CREATE INDEX "gl_posting_logs_batchKey_idx"  ON "gl_posting_logs"("batchKey");
CREATE INDEX "gl_posting_logs_postedAt_idx"  ON "gl_posting_logs"("postedAt");
