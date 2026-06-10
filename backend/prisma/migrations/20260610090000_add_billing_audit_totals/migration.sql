-- Invoice-level totals for the diagnosis-billing audit: gross, discount/rebate,
-- tax, sponsor/insurer coverage (deduction), and net payable (final amount).
-- Additive, nullable — no data loss.

ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "billingAuditTotals" JSONB;
