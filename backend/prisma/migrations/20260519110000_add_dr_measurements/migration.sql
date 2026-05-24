-- E2: DR measurement table — stores monthly RTO/RPO readings from the restore drill cron.
CREATE TABLE "dr_measurements" (
    "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
    "measured_at"  TIMESTAMPTZ NOT NULL,
    "rto_seconds"  INTEGER     NOT NULL,
    "rpo_seconds"  INTEGER     NOT NULL,
    "backup_key"   TEXT        NOT NULL,
    "raw_json"     JSONB,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "dr_measurements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dr_measurements_measured_at_idx" ON "dr_measurements"("measured_at" DESC);
