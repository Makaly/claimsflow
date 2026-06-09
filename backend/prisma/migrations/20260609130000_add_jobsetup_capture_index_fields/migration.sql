-- Job Setups → Kodak Capture Pro parity, Phase 1.
-- Richer index-field config (validation, input mask, system values, OCR-zone
-- binding, double-key verify), document/batch naming patterns on the setup, and
-- atomic named counters. All additive — no data loss.

-- ── job_setup_fields: richer field config ────────────────────────────────────
ALTER TABLE "job_setup_fields" ADD COLUMN IF NOT EXISTS "validation" JSONB;
ALTER TABLE "job_setup_fields" ADD COLUMN IF NOT EXISTS "inputMask" TEXT;
ALTER TABLE "job_setup_fields" ADD COLUMN IF NOT EXISTS "systemValue" TEXT;
ALTER TABLE "job_setup_fields" ADD COLUMN IF NOT EXISTS "zone" JSONB;
ALTER TABLE "job_setup_fields" ADD COLUMN IF NOT EXISTS "verifyDoubleKey" BOOLEAN NOT NULL DEFAULT false;

-- ── job_setups: naming patterns ──────────────────────────────────────────────
ALTER TABLE "job_setups" ADD COLUMN IF NOT EXISTS "naming" JSONB;

-- ── job_setup_counters: atomic named sequences per setup ─────────────────────
CREATE TABLE IF NOT EXISTS "job_setup_counters" (
    "id" TEXT NOT NULL,
    "jobSetupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "job_setup_counters_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "job_setup_counters_jobSetupId_name_key"
    ON "job_setup_counters"("jobSetupId", "name");
ALTER TABLE "job_setup_counters" DROP CONSTRAINT IF EXISTS "job_setup_counters_jobSetupId_fkey";
ALTER TABLE "job_setup_counters" ADD CONSTRAINT "job_setup_counters_jobSetupId_fkey"
    FOREIGN KEY ("jobSetupId") REFERENCES "job_setups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
