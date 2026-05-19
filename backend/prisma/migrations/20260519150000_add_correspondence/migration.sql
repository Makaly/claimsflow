-- F2: Letter templates for the correspondence module.
CREATE TABLE "letter_templates" (
    "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
    "code"          TEXT        NOT NULL,
    "name"          TEXT        NOT NULL,
    "subject"       TEXT        NOT NULL,
    "body_template" TEXT        NOT NULL,
    "channel"       TEXT        NOT NULL DEFAULT 'both',  -- email|pdf|both
    "locale"        TEXT        NOT NULL DEFAULT 'en',
    "is_active"     BOOLEAN     NOT NULL DEFAULT true,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "letter_templates_pkey"     PRIMARY KEY ("id"),
    CONSTRAINT "letter_templates_code_key" UNIQUE ("code"),
    CONSTRAINT "letter_templates_channel_check" CHECK ("channel" IN ('email','pdf','both'))
);

CREATE INDEX "letter_templates_code_idx" ON "letter_templates"("code");
CREATE INDEX "letter_templates_active_idx" ON "letter_templates"("is_active");

-- Seed 4 required templates (idempotent via ON CONFLICT DO NOTHING).
INSERT INTO "letter_templates" ("code","name","subject","body_template","channel","locale") VALUES
(
  'claim_rejected',
  'Claim Rejection Notice',
  'Your claim {{claimNumber}} has been rejected',
  'Dear {{memberName}},\n\nWe regret to inform you that your medical claim {{claimNumber}} submitted on {{submissionDate}} has been rejected.\n\nReason: {{rejectionReason}}\n\nIf you believe this decision is incorrect, you may file an appeal within 30 days of this notice.\n\nYours sincerely,\nClaimsFlow Team\nCIC Insurance Group PLC',
  'both',
  'en'
),
(
  'appeal_outcome',
  'Appeal Outcome Letter',
  'Appeal outcome for claim {{claimNumber}}',
  'Dear {{memberName}},\n\nWe have completed our review of your appeal regarding claim {{claimNumber}}.\n\nOutcome: {{appealOutcome}}\n{{outcomeNotes}}\n\nYours sincerely,\nAppeals Department\nCIC Insurance Group PLC',
  'both',
  'en'
),
(
  'member_acknowledgement',
  'Claim Acknowledgement',
  'We have received your claim {{claimNumber}}',
  'Dear {{memberName}},\n\nThank you for submitting your medical claim {{claimNumber}}. We have received it and it is currently under review.\n\nExpected turnaround: {{expectedDays}} business days.\n\nYours sincerely,\nClaims Team\nCIC Insurance Group PLC',
  'email',
  'en'
),
(
  'provider_remittance_summary',
  'Provider Remittance Summary',
  'Payment remittance — {{adviceNumber}}',
  'Dear {{providerName}},\n\nPlease find below the remittance summary for payment advice {{adviceNumber}} dated {{paymentDate}}.\n\nTotal amount: {{currency}} {{totalAmount}}\nClaims included: {{claimCount}}\n\nYours sincerely,\nFinance Department\nCIC Insurance Group PLC',
  'pdf',
  'en'
)
ON CONFLICT ("code") DO NOTHING;
