-- Job Setups → Kodak Capture Pro parity: pipeline config blocks on the setup.
-- Capture (scan/image) settings, document separation rules, and export targets.
-- All additive, nullable JSONB — no data loss. Execution lands in later phases;
-- the columns exist now so the tabbed editor persists config from the start.

ALTER TABLE "job_setups" ADD COLUMN IF NOT EXISTS "captureSettings" JSONB;
ALTER TABLE "job_setups" ADD COLUMN IF NOT EXISTS "separationRules" JSONB;
ALTER TABLE "job_setups" ADD COLUMN IF NOT EXISTS "outputTargets" JSONB;
