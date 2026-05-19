-- T2.4 — configurable cross-provider duplicate-detection window per claim type
CREATE TABLE claim_type_config (
  id           TEXT        NOT NULL,
  "claimType"  TEXT        NOT NULL,
  "windowDays" INTEGER     NOT NULL,
  "updatedBy"  TEXT,
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT claim_type_config_pkey PRIMARY KEY (id),
  CONSTRAINT claim_type_config_claim_type_key UNIQUE ("claimType")
);

CREATE INDEX claim_type_config_claim_type_idx ON claim_type_config ("claimType");

-- Seed the typical Kenya medical-insurance categories with sensible defaults.
-- 'default' is the row consulted when the caller does not know the claim type.
INSERT INTO claim_type_config (id, "claimType", "windowDays") VALUES
  (gen_random_uuid()::text, 'default',    0),
  (gen_random_uuid()::text, 'pharmacy',   7),
  (gen_random_uuid()::text, 'outpatient', 30),
  (gen_random_uuid()::text, 'inpatient',  120),
  (gen_random_uuid()::text, 'dental',     14),
  (gen_random_uuid()::text, 'optical',    180);
