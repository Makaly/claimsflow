-- AlterTable
ALTER TABLE "claims" ADD COLUMN "branchId" TEXT;

-- AlterTable
ALTER TABLE "batch_submissions" ADD COLUMN "branchId" TEXT;

-- CreateIndex
CREATE INDEX "claims_branchId_idx" ON "claims"("branchId");

-- CreateIndex
CREATE INDEX "batch_submissions_branchId_idx" ON "batch_submissions"("branchId");

-- Backfill omitted: users.branchId does not exist at this migration step.
-- New installations start with no data, so no backfill is needed.
