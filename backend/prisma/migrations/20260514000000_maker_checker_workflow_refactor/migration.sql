-- Maker-Checker workflow refactor (2026-05-14)
--
-- 1) Migrate users away from removed roles:
--    - `supervisor` → `claims_officer`
--    - `checker`    → `maker_checker`
-- 2) Add new Claim fields for fraud verdict and claims-officer approval tracking.
-- 3) Add AppealMessage table for three-party appeal conversations.
-- 4) Re-route claims that were sitting in `final_approval` (old terminal stage
--    before payment) so they don't get stuck — they become `claims_officer_review`.
-- 5) Re-route any `fraud_hold` claims that had been cleared back through the
--    old maker flow stays unchanged in this migration; runtime code now sends
--    cleared claims to claims_officer_review instead.

BEGIN;

-- 1a. Re-assign single-role users.
UPDATE "users" SET "role" = 'claims_officer' WHERE "role" = 'supervisor';
UPDATE "users" SET "role" = 'maker_checker' WHERE "role" = 'checker';

-- 1b. Re-assign RBAC mapping table entries for users who held supervisor/checker
-- via user_roles. We map them into the equivalent new roles by name.
-- (Done in seed.ts on next boot — the role rows themselves are re-seeded.)
DELETE FROM "user_roles" WHERE "roleId" IN (
  SELECT "id" FROM "roles" WHERE "name" IN ('supervisor', 'checker')
);
DELETE FROM "role_permissions" WHERE "roleId" IN (
  SELECT "id" FROM "roles" WHERE "name" IN ('supervisor', 'checker')
);
DELETE FROM "roles" WHERE "name" IN ('supervisor', 'checker');

-- 2. Add Claim fields supporting the new workflow.
ALTER TABLE "claims"
  ADD COLUMN IF NOT EXISTS "fraudVerdict"           TEXT,
  ADD COLUMN IF NOT EXISTS "fraudVerdictAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "fraudVerdictBy"         TEXT,
  ADD COLUMN IF NOT EXISTS "fraudVerdictNotes"      TEXT,
  ADD COLUMN IF NOT EXISTS "claimsOfficerApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "claimsOfficerApprovedBy" TEXT;

CREATE INDEX IF NOT EXISTS "claims_fraudVerdict_idx" ON "claims"("fraudVerdict");

-- 3. AppealMessage — multi-party thread on an appeal.
CREATE TABLE IF NOT EXISTS "appeal_messages" (
  "id"           TEXT NOT NULL,
  "appealId"     TEXT NOT NULL,
  "senderId"     TEXT NOT NULL,
  "senderRole"   TEXT NOT NULL,
  "message"      TEXT NOT NULL,
  "attachments"  JSONB NOT NULL DEFAULT '[]',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "appeal_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "appeal_messages_appealId_idx" ON "appeal_messages"("appealId");
CREATE INDEX IF NOT EXISTS "appeal_messages_senderId_idx" ON "appeal_messages"("senderId");
CREATE INDEX IF NOT EXISTS "appeal_messages_createdAt_idx" ON "appeal_messages"("createdAt");

ALTER TABLE "appeal_messages"
  ADD CONSTRAINT "appeal_messages_appealId_fkey"
  FOREIGN KEY ("appealId") REFERENCES "appeals"("id") ON DELETE CASCADE;

ALTER TABLE "appeal_messages"
  ADD CONSTRAINT "appeal_messages_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT;

-- 4. Re-route claims currently in final_approval to the new claims_officer_review.
-- Old flow auto-marked these as approved; under the new flow the claims officer
-- needs to give final sign-off explicitly. Status returns to under_review.
UPDATE "claims"
  SET "workflowStage" = 'claims_officer_review',
      "status"        = CASE WHEN "status" = 'approved' THEN 'under_review' ELSE "status" END
  WHERE "workflowStage" = 'final_approval';

-- 5. Rename checker_review stage references to maker_checker_review so the
-- name reflects the single combined role.
UPDATE "claims"
  SET "workflowStage" = 'maker_checker_review'
  WHERE "workflowStage" IN ('checker_review', 'maker_review');

-- The claim_status_history audit trail is deliberately left untouched —
-- it records what happened under the old role/stage names and must stay
-- immutable for compliance.

COMMIT;
