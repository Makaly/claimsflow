-- E5: Multi-tenancy groundwork — Tenant table + nullable tenantId columns.
--
-- Fully idempotent: safe to re-run when tenants was already (partially)
-- created by 20260519210000_add_multi_tenant_scaffolding, which used
-- "isActive" instead of "active" and omitted "brandingJsonb".

CREATE TABLE IF NOT EXISTS "tenants" (
    "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
    "slug"          TEXT        NOT NULL,
    "name"          TEXT        NOT NULL,
    "brandingJsonb" JSONB       NOT NULL DEFAULT '{}',
    "active"        BOOLEAN     NOT NULL DEFAULT true,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "tenants_pkey"      PRIMARY KEY ("id"),
    CONSTRAINT "tenants_slug_key"  UNIQUE ("slug")
);

-- Ensure all required columns are present regardless of which migration
-- originally created the table (handles schema drift from 20260519210000).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "brandingJsonb" JSONB       NOT NULL DEFAULT '{}';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "active"        BOOLEAN     NOT NULL DEFAULT true;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS "tenants_slug_idx"   ON "tenants"("slug");
CREATE INDEX IF NOT EXISTS "tenants_active_idx" ON "tenants"("active");

-- Add nullable tenantId to core tables.
-- users/providers/claims/documents/batch_submissions/ocr_extractions already have
-- "tenantId" from 20260519210000 — ADD COLUMN IF NOT EXISTS is a no-op for those.
-- payment_advices and activity_logs were not covered by that migration.

ALTER TABLE "users"           ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "providers"       ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "claims"          ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "documents"       ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "payment_advices" ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "activity_logs"   ADD COLUMN IF NOT EXISTS "tenantId" UUID;

-- FK constraints — use DO blocks so duplicate constraint names don't abort the migration.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_advices_tenant_id_fkey') THEN
    ALTER TABLE "payment_advices"
      ADD CONSTRAINT "payment_advices_tenant_id_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_logs_tenant_id_fkey') THEN
    ALTER TABLE "activity_logs"
      ADD CONSTRAINT "activity_logs_tenant_id_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "users_tenantId_idx"           ON "users"("tenantId");
CREATE INDEX IF NOT EXISTS "providers_tenantId_idx"       ON "providers"("tenantId");
CREATE INDEX IF NOT EXISTS "claims_tenantId_idx"          ON "claims"("tenantId");
CREATE INDEX IF NOT EXISTS "documents_tenantId_idx"       ON "documents"("tenantId");
CREATE INDEX IF NOT EXISTS "payment_advices_tenantId_idx" ON "payment_advices"("tenantId");
CREATE INDEX IF NOT EXISTS "activity_logs_tenantId_idx"   ON "activity_logs"("tenantId");
