-- T3.1 — public holidays table for business-hours SLA
CREATE TABLE public_holidays (
  id         UUID        NOT NULL DEFAULT gen_random_uuid(),
  "date"     DATE        NOT NULL,
  name       TEXT        NOT NULL,
  country    TEXT        NOT NULL DEFAULT 'KE',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT public_holidays_pkey PRIMARY KEY (id),
  CONSTRAINT public_holidays_date_country_key UNIQUE ("date", country)
);

CREATE INDEX public_holidays_date_idx ON public_holidays ("date");

-- T3.1 — SLA value-band config rows are stored in system_config;
--         no schema change needed.

-- T3.2 — user active-status and seniority tier
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "activeStatus"  TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "seniorityTier" TEXT NOT NULL DEFAULT 'mid';

CREATE INDEX IF NOT EXISTS users_active_status_idx ON users ("activeStatus");

-- T3.3 — per-user notification preferences
CREATE TABLE notification_preferences (
  "userId"       TEXT        NOT NULL,
  mode           TEXT        NOT NULL DEFAULT 'realtime',  -- realtime | hourly | daily
  "quietStart"   SMALLINT,                                 -- hour 0-23 (local)
  "quietEnd"     SMALLINT,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_pkey PRIMARY KEY ("userId"),
  CONSTRAINT notification_preferences_user_fk FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
);

-- notifications_queue: pending digests and buffered realtime messages
CREATE TABLE notifications_queue (
  id             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "recipientId"  TEXT        NOT NULL,
  type           TEXT        NOT NULL,
  category       TEXT        NOT NULL DEFAULT 'general', -- sla_breach | fraud_confirmed | general
  subject        TEXT,
  message        TEXT        NOT NULL,
  "htmlContent"  TEXT,
  "claimId"      TEXT,
  "providerId"   TEXT,
  "scheduledFor" TIMESTAMPTZ,                            -- null = send immediately / on next flush
  "flushedAt"    TIMESTAMPTZ,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notifications_queue_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_queue_recipient_fk FOREIGN KEY ("recipientId") REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX notifications_queue_recipient_idx ON notifications_queue ("recipientId");
CREATE INDEX notifications_queue_scheduled_idx ON notifications_queue ("scheduledFor") WHERE "flushedAt" IS NULL;

-- T3.4 — no new tables; quality_score / volume_score computed in the service
--         and returned alongside the existing blended score.

-- T3.5 — scan-metering thresholds per provider
ALTER TABLE scan_metering_settings
  ADD COLUMN IF NOT EXISTS "monthlyQuota"   INT,          -- max scans/month; null = unlimited
  ADD COLUMN IF NOT EXISTS "alertThreshold" SMALLINT NOT NULL DEFAULT 80; -- pct to trigger pacing alert

-- pacing alerts written by the daily worker
CREATE TABLE scan_pacing_alerts (
  id             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "providerId"   TEXT        NOT NULL,
  "dayOfMonth"   SMALLINT    NOT NULL,
  "usedPct"      NUMERIC(5,2) NOT NULL,
  "projectedDay" SMALLINT,               -- projected day-of-month when quota will be exhausted
  "resolvedAt"   TIMESTAMPTZ,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scan_pacing_alerts_pkey PRIMARY KEY (id),
  CONSTRAINT scan_pacing_alerts_provider_fk FOREIGN KEY ("providerId") REFERENCES providers(id) ON DELETE CASCADE
);

CREATE INDEX scan_pacing_alerts_provider_idx ON scan_pacing_alerts ("providerId", "createdAt" DESC);
CREATE INDEX scan_pacing_alerts_open_idx      ON scan_pacing_alerts ("providerId") WHERE "resolvedAt" IS NULL;
