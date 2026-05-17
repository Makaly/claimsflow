-- ML Fraud Scoring (2026-05-17)
--
-- 1) ProviderAlias — normalised name variants for OCR-extracted provider names.
--    Allows the provider-mismatch fraud signal to survive spelling differences
--    and abbreviations without generating false positives.
--
-- 2) FraudModelWeights — stores the per-factor weights produced by
--    AnomalyScoringService.calibrateWeights(). Enables adaptive scoring
--    as the labelled dataset grows.

BEGIN;

-- 1. Provider name alias table
CREATE TABLE IF NOT EXISTS "provider_aliases" (
  "id"         TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "alias"      TEXT NOT NULL,       -- normalised: lowercase, no punctuation, collapsed spaces
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_aliases_alias_key"
  ON "provider_aliases"("alias");

CREATE INDEX IF NOT EXISTS "provider_aliases_providerId_idx"
  ON "provider_aliases"("providerId");

ALTER TABLE "provider_aliases"
  ADD CONSTRAINT "provider_aliases_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Persisted fraud model weights
CREATE TABLE IF NOT EXISTS "fraud_model_weights" (
  "id"              TEXT NOT NULL,
  "weights"         JSONB NOT NULL,
  "sampleSize"      INTEGER NOT NULL,
  "fraudCount"      INTEGER NOT NULL,
  "legitimateCount" INTEGER NOT NULL,
  "trainedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isActive"        BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "fraud_model_weights_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fraud_model_weights_isActive_idx"
  ON "fraud_model_weights"("isActive");

CREATE INDEX IF NOT EXISTS "fraud_model_weights_trainedAt_idx"
  ON "fraud_model_weights"("trainedAt");

COMMIT;
