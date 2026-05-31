-- Mobile email 2FA: purpose-tagged OTPs + trusted devices.

-- Tag existing/future verification codes with their purpose so the login and
-- password-change OTP flows don't consume registration-verification codes.
ALTER TABLE "email_verification_tokens"
  ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'email_verification';

CREATE INDEX IF NOT EXISTS "email_verification_tokens_userId_purpose_idx"
  ON "email_verification_tokens" ("userId", "purpose");

-- Devices a user has confirmed via an emailed login code.
CREATE TABLE IF NOT EXISTS "trusted_devices" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "deviceId"   TEXT NOT NULL,
  "label"      TEXT,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trusted_devices_userId_deviceId_key"
  ON "trusted_devices" ("userId", "deviceId");

CREATE INDEX IF NOT EXISTS "trusted_devices_userId_idx"
  ON "trusted_devices" ("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'trusted_devices_userId_fkey'
  ) THEN
    ALTER TABLE "trusted_devices"
      ADD CONSTRAINT "trusted_devices_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
