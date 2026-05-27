-- PR3.1: ISO-3166 2-letter country code on providers.
-- Defaults to 'KE' (Kenya) since ClaimsFlow's primary market is Kenyan
-- providers — the new wizard lets the user override during registration.

ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "country" TEXT DEFAULT 'KE';

UPDATE "providers"
   SET "country" = 'KE'
 WHERE "country" IS NULL;
