-- Licensing & entitlements (E6). Additive-only: three new tables, no changes to
-- existing tables, no data loss. Hand-written because the local dev DB carries
-- pre-existing drift; this migration touches only the new objects.

-- CreateTable
CREATE TABLE "licenses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'core',
    "token" TEXT NOT NULL,
    "featuresJsonb" JSONB NOT NULL DEFAULT '[]',
    "limitsJsonb" JSONB NOT NULL DEFAULT '{}',
    "enforcement" TEXT NOT NULL DEFAULT 'report',
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "graceDays" INTEGER NOT NULL DEFAULT 14,
    "status" TEXT NOT NULL DEFAULT 'active',
    "issuedTo" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "feature" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'override',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_counters" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "limit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "licenses_tenantId_status_idx" ON "licenses"("tenantId", "status");
CREATE INDEX "licenses_status_idx" ON "licenses"("status");
CREATE INDEX "entitlements_tenantId_idx" ON "entitlements"("tenantId");
CREATE UNIQUE INDEX "entitlements_tenantId_feature_key" ON "entitlements"("tenantId", "feature");
CREATE INDEX "usage_counters_tenantId_period_idx" ON "usage_counters"("tenantId", "period");
CREATE UNIQUE INDEX "usage_counters_tenantId_metric_period_key" ON "usage_counters"("tenantId", "metric", "period");

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
