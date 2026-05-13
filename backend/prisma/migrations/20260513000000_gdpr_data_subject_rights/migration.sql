-- GDPR / KDPA data-subject rights ---------------------------------------------
-- Adds the soft-erasure marker on users plus the three append-only tables
-- backing consent, data export and Art. 22 decision-review workflows.
-- ---------------------------------------------------------------------------

ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "version" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "consent_records_userId_idx" ON "consent_records"("userId");
CREATE INDEX "consent_records_userId_purpose_idx" ON "consent_records"("userId", "purpose");
ALTER TABLE "consent_records"
    ADD CONSTRAINT "consent_records_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "data_export_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "bytes" INTEGER,
    CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "data_export_requests_userId_idx" ON "data_export_requests"("userId");
ALTER TABLE "data_export_requests"
    ADD CONSTRAINT "data_export_requests_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "decision_review_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "claimId" TEXT,
    "decisionType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewerId" TEXT,
    "reviewerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "decision_review_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "decision_review_requests_userId_idx" ON "decision_review_requests"("userId");
CREATE INDEX "decision_review_requests_status_idx" ON "decision_review_requests"("status");
ALTER TABLE "decision_review_requests"
    ADD CONSTRAINT "decision_review_requests_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
