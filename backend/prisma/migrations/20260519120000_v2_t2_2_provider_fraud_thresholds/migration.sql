-- T2.2 — per-provider fraud decision threshold (recomputed monthly from FP/FN rates)
CREATE TABLE provider_fraud_thresholds (
  id              TEXT             NOT NULL,
  "providerId"    TEXT             NOT NULL,
  threshold       DOUBLE PRECISION NOT NULL,
  "fpRate"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fnRate"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "computedAt"    TIMESTAMPTZ      NOT NULL DEFAULT now(),
  "overriddenBy"  TEXT,
  "overriddenAt"  TIMESTAMPTZ,
  CONSTRAINT provider_fraud_thresholds_pkey PRIMARY KEY (id),
  CONSTRAINT provider_fraud_thresholds_provider_key UNIQUE ("providerId"),
  CONSTRAINT provider_fraud_thresholds_provider_fk FOREIGN KEY ("providerId")
    REFERENCES providers (id) ON DELETE CASCADE
);

CREATE INDEX provider_fraud_thresholds_provider_idx ON provider_fraud_thresholds ("providerId");
CREATE INDEX provider_fraud_thresholds_computed_idx ON provider_fraud_thresholds ("computedAt");
