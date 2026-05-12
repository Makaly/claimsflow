-- AlterTable
ALTER TABLE "claims" ADD COLUMN "branchId" TEXT;

-- AlterTable
ALTER TABLE "batch_submissions" ADD COLUMN "branchId" TEXT;

-- CreateIndex
CREATE INDEX "claims_branchId_idx" ON "claims"("branchId");

-- CreateIndex
CREATE INDEX "batch_submissions_branchId_idx" ON "batch_submissions"("branchId");

-- Backfill: for every existing claim whose creator is currently bound to a
-- branch, inherit that branch. Historical claims whose creator has since
-- moved branches (or has no branch) remain NULL and are handled by the
-- fallback branch in the service layer.
UPDATE "claims" c
SET "branchId" = u."branchId"
FROM "users" u
WHERE c."createdBy" = u."id"
  AND u."branchId" IS NOT NULL
  AND c."branchId" IS NULL;

-- Backfill the equivalent column on batch_submissions.
UPDATE "batch_submissions" b
SET "branchId" = u."branchId"
FROM "users" u
WHERE b."uploadedBy" = u."id"
  AND u."branchId" IS NOT NULL
  AND b."branchId" IS NULL;
