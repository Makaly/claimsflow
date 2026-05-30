-- PR5: Provider resubmission note
-- Provider can attach a free-text note when re-submitting after returned_for_correction.
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "providerNote" TEXT;
