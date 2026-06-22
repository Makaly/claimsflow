-- Licensing E7 — rich, helpdesk-parity license model.
-- Additive-only: new columns on `tenants` + three new tables. No data loss.
-- Hand-written because the local dev DB carries out-of-band drift; this
-- migration touches only the new objects and is applied via psql, then marked
-- resolved (NOT via `migrate dev`, which would demand a destructive reset).

-- ── tenants: live license state (the tenant row IS the license record) ──
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "plan"                   TEXT NOT NULL DEFAULT 'core',
  ADD COLUMN IF NOT EXISTS "licenseKey"             TEXT,
  ADD COLUMN IF NOT EXISTS "licenseType"            TEXT NOT NULL DEFAULT 'TRIAL',
  ADD COLUMN IF NOT EXISTS "licenseStartDate"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "licenseExpiryDate"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "licenseStatus"          TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "licensePausedAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "maxSeats"               INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "maxClaimsPerMonth"      INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS "maxExtractionsPerMonth" INTEGER NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS "enabledFeaturesJsonb"   JSONB NOT NULL DEFAULT '[]';

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_licenseKey_key" ON "tenants"("licenseKey");
CREATE INDEX IF NOT EXISTS "tenants_licenseStatus_idx" ON "tenants"("licenseStatus");
CREATE INDEX IF NOT EXISTS "tenants_licenseExpiryDate_idx" ON "tenants"("licenseExpiryDate");

-- ── license_pause_requests ──
CREATE TABLE IF NOT EXISTS "license_pause_requests" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "type"        TEXT NOT NULL DEFAULT 'PAUSE',
    "status"      TEXT NOT NULL DEFAULT 'PENDING',
    "reason"      TEXT,
    "proofUrl"    TEXT,
    "ticketRef"   TEXT,
    "daysPaused"  INTEGER,
    "requestedBy" TEXT,
    "reviewedBy"  TEXT,
    "reviewedAt"  TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "license_pause_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "license_pause_requests_tenantId_status_idx" ON "license_pause_requests"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "license_pause_requests_status_idx" ON "license_pause_requests"("status");

-- ── license_billing_invoices ──
CREATE TABLE IF NOT EXISTS "license_billing_invoices" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "invoiceNumber"  TEXT NOT NULL,
    "plan"           TEXT NOT NULL,
    "seats"          INTEGER NOT NULL DEFAULT 1,
    "unitPrice"      DECIMAL(12,2) NOT NULL DEFAULT 0,
    "subtotal"       DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vatRate"        DECIMAL(5,4) NOT NULL DEFAULT 0,
    "vatAmount"      DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total"          DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountPaid"     DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency"       TEXT NOT NULL DEFAULT 'KES',
    "periodFrom"     TIMESTAMP(3) NOT NULL,
    "periodTo"       TIMESTAMP(3) NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'DRAFT',
    "licenseApplied" BOOLEAN NOT NULL DEFAULT false,
    "integrityHash"  TEXT,
    "issuedTo"       TEXT,
    "notes"          TEXT,
    "createdBy"      TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "license_billing_invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "license_billing_invoices_invoiceNumber_key" ON "license_billing_invoices"("invoiceNumber");
CREATE INDEX IF NOT EXISTS "license_billing_invoices_tenantId_status_idx" ON "license_billing_invoices"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "license_billing_invoices_status_idx" ON "license_billing_invoices"("status");

-- ── license_billing_payments ──
CREATE TABLE IF NOT EXISTS "license_billing_payments" (
    "id"         TEXT NOT NULL,
    "invoiceId"  TEXT NOT NULL,
    "amount"     DECIMAL(12,2) NOT NULL DEFAULT 0,
    "method"     TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference"  TEXT,
    "paidAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "license_billing_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "license_billing_payments_invoiceId_idx" ON "license_billing_payments"("invoiceId");

-- ── Foreign keys ──
ALTER TABLE "license_pause_requests"
  ADD CONSTRAINT "license_pause_requests_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "license_billing_invoices"
  ADD CONSTRAINT "license_billing_invoices_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "license_billing_payments"
  ADD CONSTRAINT "license_billing_payments_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "license_billing_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
