-- Installation-based licensing (E8) — phone-home / heartbeat model.
-- Additive-only: three new tables, no changes to existing objects.
-- Apply via psql, then `prisma migrate resolve --applied 20260622160000_installation_licensing_e8`.

-- License-server side: registry of activated installations.
CREATE TABLE IF NOT EXISTS "installations" (
    "id"            TEXT NOT NULL,
    "label"         TEXT,
    "hostname"      TEXT,
    "version"       TEXT,
    "plan"          TEXT NOT NULL DEFAULT 'core',
    "status"        TEXT NOT NULL DEFAULT 'ACTIVE',
    "featuresJsonb" JSONB NOT NULL DEFAULT '[]',
    "limitsJsonb"   JSONB NOT NULL DEFAULT '{}',
    "secretHash"    TEXT,
    "activationKey" TEXT,
    "registeredAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"    TIMESTAMP(3),
    "lastSeenIp"    TEXT,
    "leaseTtlHours" INTEGER NOT NULL DEFAULT 168,
    "expiresAt"     TIMESTAMP(3),
    "notes"         TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "installations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "installations_status_idx" ON "installations"("status");
CREATE INDEX IF NOT EXISTS "installations_lastSeenAt_idx" ON "installations"("lastSeenAt");

-- License-server side: activation keys.
CREATE TABLE IF NOT EXISTS "activation_keys" (
    "id"                  TEXT NOT NULL,
    "key"                 TEXT NOT NULL,
    "plan"                TEXT NOT NULL DEFAULT 'core',
    "status"              TEXT NOT NULL DEFAULT 'UNUSED',
    "maxActivations"      INTEGER NOT NULL DEFAULT 1,
    "usedCount"           INTEGER NOT NULL DEFAULT 0,
    "boundInstallationId" TEXT,
    "issuedTo"            TEXT,
    "termDays"            INTEGER NOT NULL DEFAULT 365,
    "expiresAt"           TIMESTAMP(3),
    "createdBy"           TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    CONSTRAINT "activation_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "activation_keys_key_key" ON "activation_keys"("key");
CREATE INDEX IF NOT EXISTS "activation_keys_status_idx" ON "activation_keys"("status");

-- Client side: local installation identity + cached lease (singleton).
CREATE TABLE IF NOT EXISTS "system_installation" (
    "id"              TEXT NOT NULL,
    "singleton"       BOOLEAN NOT NULL DEFAULT true,
    "label"           TEXT,
    "installSecret"   TEXT,
    "activationKey"   TEXT,
    "plan"            TEXT,
    "status"          TEXT NOT NULL DEFAULT 'UNLICENSED',
    "leaseToken"      TEXT,
    "leaseExpiresAt"  TIMESTAMP(3),
    "lastValidatedAt" TIMESTAMP(3),
    "lastError"       TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "system_installation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "system_installation_singleton_key" ON "system_installation"("singleton");
