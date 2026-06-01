-- Upload-source metadata: which client channel produced a batch/claim.
ALTER TABLE "batch_submissions" ADD COLUMN IF NOT EXISTS "sourcePlatform" TEXT;
ALTER TABLE "batch_submissions" ADD COLUMN IF NOT EXISTS "appVersion" TEXT;
ALTER TABLE "batch_submissions" ADD COLUMN IF NOT EXISTS "deviceInfo" TEXT;

ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "sourcePlatform" TEXT;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "appVersion" TEXT;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "deviceInfo" TEXT;

CREATE INDEX IF NOT EXISTS "batch_submissions_sourcePlatform_idx" ON "batch_submissions"("sourcePlatform");
CREATE INDEX IF NOT EXISTS "claims_sourcePlatform_idx" ON "claims"("sourcePlatform");
