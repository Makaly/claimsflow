-- Billing exemption: provider keeps scanning/uploading but is not charged.
ALTER TABLE "scan_metering_settings"
  ADD COLUMN "billingExempt" BOOLEAN NOT NULL DEFAULT false;

-- Notional list price per event, so dashboards can show foregone (waived)
-- revenue for billing-exempt providers. Backfill existing rows: pre-exemption
-- every charged scan was billed at its full price, so list == billed.
ALTER TABLE "scan_events"
  ADD COLUMN "listCostAtScan" DECIMAL(10,2) NOT NULL DEFAULT 0;

UPDATE "scan_events" SET "listCostAtScan" = "costAtScan";
