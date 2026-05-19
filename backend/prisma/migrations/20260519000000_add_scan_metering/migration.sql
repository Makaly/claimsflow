-- Scan metering: per-organization enable/disable + per-scan event log
--
-- Why: track every document scanned via the ClaimsFlow Scan Agent (or camera
-- fallback) so we can show usage dashboards and bill organizations.

-- ── Per-provider settings (one row per Provider) ───────────────────────────
CREATE TABLE "scan_metering_settings" (
    "providerId"      TEXT NOT NULL,
    "enabled"         BOOLEAN NOT NULL DEFAULT true,
    "costPerScan"     DECIMAL(10,2) NOT NULL DEFAULT 5.00,
    "currency"        TEXT NOT NULL DEFAULT 'KES',
    "updatedByUserId" TEXT,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_metering_settings_pkey" PRIMARY KEY ("providerId")
);

ALTER TABLE "scan_metering_settings"
  ADD CONSTRAINT "scan_metering_settings_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scan_metering_settings"
  ADD CONSTRAINT "scan_metering_settings_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Per-scan event log ─────────────────────────────────────────────────────
CREATE TABLE "scan_events" (
    "id"               TEXT NOT NULL,
    "userId"           TEXT NOT NULL,
    "providerId"       TEXT,
    "branchId"         TEXT,
    "deviceClass"      TEXT NOT NULL,             -- 'desktop' | 'mobile' | 'camera'
    "os"               TEXT,                      -- 'linux' | 'windows' | 'darwin' | 'android' | 'ios' | 'web'
    "machineHostname"  TEXT,                      -- from scan-agent /health
    "userAgent"        TEXT,
    "scannerName"      TEXT,
    "resolution"       INTEGER,
    "mode"             TEXT,
    "pages"            INTEGER,
    "costAtScan"       DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency"         TEXT NOT NULL DEFAULT 'KES',
    "success"          BOOLEAN NOT NULL DEFAULT true,
    "errorMessage"     TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "scan_events"
  ADD CONSTRAINT "scan_events_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scan_events"
  ADD CONSTRAINT "scan_events_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scan_events"
  ADD CONSTRAINT "scan_events_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "scan_events_providerId_createdAt_idx" ON "scan_events"("providerId", "createdAt" DESC);
CREATE INDEX "scan_events_userId_createdAt_idx"     ON "scan_events"("userId",     "createdAt" DESC);
CREATE INDEX "scan_events_createdAt_idx"            ON "scan_events"("createdAt" DESC);
