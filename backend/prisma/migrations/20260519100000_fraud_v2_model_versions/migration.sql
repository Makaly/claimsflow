-- T2.1: model_versions table — tracks each weekly retrain run
-- status: 'candidate' | 'active' | 'superseded'

CREATE TABLE "model_versions" (
    "id"              TEXT NOT NULL,
    "trainedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sampleSize"      INTEGER NOT NULL,
    "fraudCount"      INTEGER NOT NULL,
    "legitimateCount" INTEGER NOT NULL,
    "metricsJson"     JSONB NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'candidate',
    "promotedAt"      TIMESTAMP(3),
    "supersededAt"    TIMESTAMP(3),
    "notes"           TEXT,

    CONSTRAINT "model_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "model_versions_status_idx"    ON "model_versions"("status");
CREATE INDEX "model_versions_trainedAt_idx" ON "model_versions"("trainedAt");
