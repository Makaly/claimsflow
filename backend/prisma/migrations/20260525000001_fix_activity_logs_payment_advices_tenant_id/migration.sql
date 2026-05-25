-- Surgical fix: add missing tenantId to activity_logs and payment_advices.
--
-- 20260519210000_add_multi_tenant_scaffolding covered only 6 tables and skipped
-- these two. 20260519130000_add_multi_tenancy was supposed to fill the gap but
-- failed in a previous deploy cycle before reaching these ALTER TABLE statements.
-- This migration is idempotent and safe to re-run.

ALTER TABLE "activity_logs"   ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "payment_advices" ADD COLUMN IF NOT EXISTS "tenantId" UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activity_logs_tenant_id_fkey'
  ) THEN
    ALTER TABLE "activity_logs"
      ADD CONSTRAINT "activity_logs_tenant_id_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_advices_tenant_id_fkey'
  ) THEN
    ALTER TABLE "payment_advices"
      ADD CONSTRAINT "payment_advices_tenant_id_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "activity_logs_tenantId_idx"   ON "activity_logs"("tenantId");
CREATE INDEX IF NOT EXISTS "payment_advices_tenantId_idx" ON "payment_advices"("tenantId");
