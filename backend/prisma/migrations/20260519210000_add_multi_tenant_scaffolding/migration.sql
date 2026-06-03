-- Phase 4 — multi-tenant scaffolding.
--
-- Adds a tenants table and nullable tenant_id columns on the core scoped
-- entities. Every tenant_id is NULL-by-default so existing rows and existing
-- single-organisation deployments continue to work without migration data
-- writes.
--
-- IDEMPOTENT: the earlier 20260519130000_add_multi_tenancy migration also
-- creates `tenants` (idempotently) and sorts first on a fresh from-scratch
-- replay — the one Prisma runs in its shadow database for `migrate dev`. Every
-- statement here is therefore guarded so the replay succeeds whichever
-- migration created the table first. In a real (already-migrated) database
-- these guards make the whole migration a no-op.

-- Tenants ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL,
  "isActive"  BOOLEAN     NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT tenants_pkey PRIMARY KEY (id),
  CONSTRAINT tenants_slug_key UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS tenants_slug_idx ON tenants (slug);

-- The "isActive" column only exists when THIS migration created the table; the
-- canonical add_multi_tenancy migration uses an "active" column instead. Guard
-- the index so the replay does not reference a column that may be absent.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'isActive'
  ) THEN
    CREATE INDEX IF NOT EXISTS tenants_is_active_idx ON tenants ("isActive");
  END IF;
END $$;

-- Each scoped table below gets a nullable "tenantId", an FK to tenants, and an
-- index. ADD COLUMN / CREATE INDEX use IF NOT EXISTS; the FK is wrapped in a DO
-- block guarded on the constraint name so a re-run never aborts.

-- users -----------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS "tenantId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_id_fkey') THEN
    ALTER TABLE users ADD CONSTRAINT users_tenant_id_fkey
      FOREIGN KEY ("tenantId") REFERENCES tenants (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS users_tenant_id_idx ON users ("tenantId");

-- providers -------------------------------------------------------------

ALTER TABLE providers ADD COLUMN IF NOT EXISTS "tenantId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_tenant_id_fkey') THEN
    ALTER TABLE providers ADD CONSTRAINT providers_tenant_id_fkey
      FOREIGN KEY ("tenantId") REFERENCES tenants (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS providers_tenant_id_idx ON providers ("tenantId");

-- claims ----------------------------------------------------------------

ALTER TABLE claims ADD COLUMN IF NOT EXISTS "tenantId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claims_tenant_id_fkey') THEN
    ALTER TABLE claims ADD CONSTRAINT claims_tenant_id_fkey
      FOREIGN KEY ("tenantId") REFERENCES tenants (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS claims_tenant_id_idx ON claims ("tenantId");

-- documents -------------------------------------------------------------

ALTER TABLE documents ADD COLUMN IF NOT EXISTS "tenantId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_tenant_id_fkey') THEN
    ALTER TABLE documents ADD CONSTRAINT documents_tenant_id_fkey
      FOREIGN KEY ("tenantId") REFERENCES tenants (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS documents_tenant_id_idx ON documents ("tenantId");

-- batch_submissions -----------------------------------------------------

ALTER TABLE batch_submissions ADD COLUMN IF NOT EXISTS "tenantId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_submissions_tenant_id_fkey') THEN
    ALTER TABLE batch_submissions ADD CONSTRAINT batch_submissions_tenant_id_fkey
      FOREIGN KEY ("tenantId") REFERENCES tenants (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS batch_submissions_tenant_id_idx ON batch_submissions ("tenantId");

-- ocr_extractions -------------------------------------------------------

ALTER TABLE ocr_extractions ADD COLUMN IF NOT EXISTS "tenantId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ocr_extractions_tenant_id_fkey') THEN
    ALTER TABLE ocr_extractions ADD CONSTRAINT ocr_extractions_tenant_id_fkey
      FOREIGN KEY ("tenantId") REFERENCES tenants (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ocr_extractions_tenant_id_idx ON ocr_extractions ("tenantId");
