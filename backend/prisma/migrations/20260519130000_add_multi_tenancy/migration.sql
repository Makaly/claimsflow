-- E5: Multi-tenancy groundwork — Tenant table + nullable tenant_id columns.

CREATE TABLE "tenants" (
    "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
    "slug"           TEXT        NOT NULL,
    "name"           TEXT        NOT NULL,
    "branding_jsonb" JSONB       NOT NULL DEFAULT '{}',
    "active"         BOOLEAN     NOT NULL DEFAULT true,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "tenants_pkey"      PRIMARY KEY ("id"),
    CONSTRAINT "tenants_slug_key"  UNIQUE ("slug")
);

CREATE INDEX "tenants_slug_idx"   ON "tenants"("slug");
CREATE INDEX "tenants_active_idx" ON "tenants"("active");

-- Add nullable tenant_id to core tables.
-- Default NULL = the existing "default" tenant (backwards-compatible).
ALTER TABLE "users"           ADD COLUMN "tenant_id" UUID REFERENCES "tenants"("id") ON DELETE SET NULL;
ALTER TABLE "providers"       ADD COLUMN "tenant_id" UUID REFERENCES "tenants"("id") ON DELETE SET NULL;
ALTER TABLE "claims"          ADD COLUMN "tenant_id" UUID REFERENCES "tenants"("id") ON DELETE SET NULL;
ALTER TABLE "documents"       ADD COLUMN "tenant_id" UUID REFERENCES "tenants"("id") ON DELETE SET NULL;
ALTER TABLE "payment_advices" ADD COLUMN "tenant_id" UUID REFERENCES "tenants"("id") ON DELETE SET NULL;
ALTER TABLE "activity_logs"   ADD COLUMN "tenant_id" UUID REFERENCES "tenants"("id") ON DELETE SET NULL;

CREATE INDEX "users_tenant_id_idx"           ON "users"("tenant_id");
CREATE INDEX "providers_tenant_id_idx"       ON "providers"("tenant_id");
CREATE INDEX "claims_tenant_id_idx"          ON "claims"("tenant_id");
CREATE INDEX "documents_tenant_id_idx"       ON "documents"("tenant_id");
CREATE INDEX "payment_advices_tenant_id_idx" ON "payment_advices"("tenant_id");
CREATE INDEX "activity_logs_tenant_id_idx"   ON "activity_logs"("tenant_id");
