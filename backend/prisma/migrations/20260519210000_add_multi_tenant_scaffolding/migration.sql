-- Phase 4 — multi-tenant scaffolding.
--
-- Adds a tenants table and nullable tenant_id columns on the six core
-- scoped entities. Every tenant_id is NULL-by-default so existing rows
-- and existing single-organisation deployments continue to work without
-- migration data writes. A future SaaS rollout will:
--   1. INSERT a default Tenant row.
--   2. UPDATE the existing entities to point at it.
--   3. Flip the columns to NOT NULL in a follow-up migration.

-- Tenants ---------------------------------------------------------------

CREATE TABLE tenants (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL,
  "isActive"  BOOLEAN     NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT tenants_pkey PRIMARY KEY (id),
  CONSTRAINT tenants_slug_key UNIQUE (slug)
);

CREATE INDEX tenants_slug_idx       ON tenants (slug);
CREATE INDEX tenants_is_active_idx  ON tenants ("isActive");

-- users -----------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "tenantId" UUID;

ALTER TABLE users
  ADD CONSTRAINT users_tenant_id_fkey
  FOREIGN KEY ("tenantId") REFERENCES tenants (id)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS users_tenant_id_idx ON users ("tenantId");

-- providers -------------------------------------------------------------

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS "tenantId" UUID;

ALTER TABLE providers
  ADD CONSTRAINT providers_tenant_id_fkey
  FOREIGN KEY ("tenantId") REFERENCES tenants (id)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS providers_tenant_id_idx ON providers ("tenantId");

-- claims ----------------------------------------------------------------

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS "tenantId" UUID;

ALTER TABLE claims
  ADD CONSTRAINT claims_tenant_id_fkey
  FOREIGN KEY ("tenantId") REFERENCES tenants (id)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS claims_tenant_id_idx ON claims ("tenantId");

-- documents -------------------------------------------------------------

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS "tenantId" UUID;

ALTER TABLE documents
  ADD CONSTRAINT documents_tenant_id_fkey
  FOREIGN KEY ("tenantId") REFERENCES tenants (id)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS documents_tenant_id_idx ON documents ("tenantId");

-- batch_submissions -----------------------------------------------------

ALTER TABLE batch_submissions
  ADD COLUMN IF NOT EXISTS "tenantId" UUID;

ALTER TABLE batch_submissions
  ADD CONSTRAINT batch_submissions_tenant_id_fkey
  FOREIGN KEY ("tenantId") REFERENCES tenants (id)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS batch_submissions_tenant_id_idx ON batch_submissions ("tenantId");

-- ocr_extractions -------------------------------------------------------

ALTER TABLE ocr_extractions
  ADD COLUMN IF NOT EXISTS "tenantId" UUID;

ALTER TABLE ocr_extractions
  ADD CONSTRAINT ocr_extractions_tenant_id_fkey
  FOREIGN KEY ("tenantId") REFERENCES tenants (id)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS ocr_extractions_tenant_id_idx ON ocr_extractions ("tenantId");
