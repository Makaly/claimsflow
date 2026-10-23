-- Demo seed: two claims that are eligible to be appealed, so the provider-facing
-- "File Appeal" flow can be exercised end-to-end.
--   1. A rejected claim under Auma Otieno's provider (Kisumu Specialists, dc7939f8)
--      → 30-day appeal window.
--   2. A fraud-confirmed claim under Samuel Rotich's provider (Eldoret Pharmacy, c7347c08)
--      → 60-day appeal window.
-- Neither has an existing appeal, so a fresh appeal can be filed against them.

BEGIN;

-- branchId/createdBy are set so the seeded claims are visible to the
-- branch-scoped provider_user who will file the appeal.
INSERT INTO claims (
  id, "claimNumber", barcode, "providerId", "branchId", "createdBy", status, "workflowStage",
  "invoiceAmount", "invoiceNumber", "memberName", "memberNumber", diagnosis,
  "rejectedAt", "rejectionReason", "isRejected",
  "createdAt", "updatedAt", "submittedAt"
) VALUES (
  'c1aimab1e-0001-0000-0000-000000000001',
  'CLM-202606-APPEALABLE01', 'BC-APPEAL-0001',
  'dc7939f8-ca66-4d86-93f9-64b1c8fab2af',
  '4d2575f7-af42-407a-b7eb-3e7924e6bdfc',           -- Auma Otieno's branch
  '5f42bd4d-feab-4edb-b6be-7daea799c0a1',           -- Auma Otieno (creator)
  'rejected', 'rejected',
  14500, 'INV-AP-001', 'John Otieno', 'MEM-55001', 'Acute appendicitis',
  '2026-06-25 10:00:00', 'Missing pre-authorisation code on the submitted invoice.', true,
  '2026-06-20 09:00:00', '2026-06-25 10:00:00', '2026-06-20 09:00:00'
);

INSERT INTO claims (
  id, "claimNumber", barcode, "providerId", "branchId", "createdBy", status, "workflowStage",
  "invoiceAmount", "invoiceNumber", "memberName", "memberNumber", diagnosis,
  "fraudVerdict", "fraudVerdictAt", "fraudVerdictNotes",
  "createdAt", "updatedAt", "submittedAt"
) VALUES (
  'c1aimab1e-0002-0000-0000-000000000002',
  'CLM-202606-APPEALABLE02', 'BC-APPEAL-0002',
  'c7347c08-a073-47fe-95cd-928ac1e411b3',
  '84924234-ed22-4d66-9869-a12bbb8b301c',           -- Samuel Rotich's branch
  '6788707c-67e4-4693-abfd-b9c1b2e9c758',           -- Samuel Rotich (creator)
  'fraud_confirmed', 'fraud_review',
  320000, 'INV-AP-002', 'Grace Atieno', 'MEM-55002', 'Chronic kidney disease',
  'confirmed', '2026-06-20 12:00:00', 'Flagged for duplicate high-value billing pattern.',
  '2026-06-15 08:00:00', '2026-06-20 12:00:00', '2026-06-15 08:00:00'
);

COMMIT;
