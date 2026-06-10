-- Provenance flag: the billing audit's diagnosis was inferred from the invoice
-- (no diagnosis was recorded on the claim). Lets the UI label it for reviewers.
-- Additive, nullable — no data loss.

ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "billingAuditDxInferred" BOOLEAN;
