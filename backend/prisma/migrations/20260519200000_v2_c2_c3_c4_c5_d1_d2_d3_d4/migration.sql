-- C2: pgvector extension + assistant tables
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "assistant_documents" (
  "id"        TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "source"    TEXT NOT NULL,
  "content"   TEXT NOT NULL,
  "embedding" vector(1536),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "assistant_documents_source_idx" ON "assistant_documents"("source");
-- HNSW index for fast ANN search; m/ef_construction tunable
CREATE INDEX "assistant_documents_embedding_hnsw_idx"
  ON "assistant_documents" USING hnsw ("embedding" vector_cosine_ops);

CREATE TABLE "assistant_interactions" (
  "id"            TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "userId"        TEXT,
  "query"         TEXT NOT NULL,
  "answer"        TEXT NOT NULL,
  "citations"     JSONB NOT NULL DEFAULT '[]',
  "topSimilarity" DOUBLE PRECISION,
  "refused"       BOOLEAN NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "assistant_interactions_userId_idx" ON "assistant_interactions"("userId");
CREATE INDEX "assistant_interactions_createdAt_idx" ON "assistant_interactions"("createdAt");

-- C3: green-lane rules
CREATE TABLE "green_lane_rules" (
  "id"                    TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "name"                  TEXT NOT NULL,
  "minValue"              DOUBLE PRECISION,
  "maxValue"              DOUBLE PRECISION,
  "minScorecardQuality"   DOUBLE PRECISION,
  "minOcrConfidence"      DOUBLE PRECISION,
  "maxFraudScore"         DOUBLE PRECISION,
  "requireNoSignals"      BOOLEAN NOT NULL DEFAULT true,
  "isActive"              BOOLEAN NOT NULL DEFAULT true,
  "providerId"            TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "green_lane_rules_isActive_idx" ON "green_lane_rules"("isActive");
CREATE INDEX "green_lane_rules_providerId_idx" ON "green_lane_rules"("providerId");

-- C5: locale column on users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locale" TEXT DEFAULT 'en';

-- D1: HMIS provider config
CREATE TABLE "hmis_provider_configs" (
  "id"          TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "providerId"  TEXT NOT NULL UNIQUE,
  "endpointUrl" TEXT,
  "hl7Version"  TEXT NOT NULL DEFAULT '2.5',
  "fhirVersion" TEXT NOT NULL DEFAULT 'R4',
  "authType"    TEXT NOT NULL DEFAULT 'none',
  "authSecret"  TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- D1: structuredSource on claims
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "structuredSource" BOOLEAN NOT NULL DEFAULT false;

-- D2: telemedicine sessions
CREATE TABLE "telemedicine_sessions" (
  "id"               TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "memberNumber"     TEXT NOT NULL,
  "providerId"       TEXT NOT NULL,
  "adapterName"      TEXT NOT NULL,
  "sessionRef"       TEXT,
  "scheduledAt"      TIMESTAMP(3) NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'booked',
  "consultationNote" TEXT,
  "claimId"          TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "telemedicine_sessions_memberNumber_idx" ON "telemedicine_sessions"("memberNumber");
CREATE INDEX "telemedicine_sessions_providerId_idx" ON "telemedicine_sessions"("providerId");
CREATE INDEX "telemedicine_sessions_status_idx" ON "telemedicine_sessions"("status");

-- D3: formulary drugs
CREATE TABLE "formulary_drugs" (
  "id"            TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "drugCode"      TEXT NOT NULL UNIQUE,
  "brandName"     TEXT NOT NULL,
  "genericName"   TEXT NOT NULL,
  "formularyTier" INTEGER NOT NULL DEFAULT 3,
  "covered"       BOOLEAN NOT NULL DEFAULT true,
  "genericAlt"    TEXT,
  "copayAmount"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "formulary_drugs_drugCode_idx" ON "formulary_drugs"("drugCode");
CREATE INDEX "formulary_drugs_covered_idx" ON "formulary_drugs"("covered");

-- D4: chronic conditions + member statuses
CREATE TABLE "chronic_conditions" (
  "id"             TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "code"           TEXT NOT NULL UNIQUE,
  "name"           TEXT NOT NULL,
  "qualifyingRule" JSONB NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "chronic_conditions"("id","code","name","qualifyingRule") VALUES
  (gen_random_uuid()::TEXT,'hypertension','Hypertension','{"icd10Prefixes":["I10","I11","I12","I13"],"minEncounters":2,"withinDays":365}'),
  (gen_random_uuid()::TEXT,'diabetes','Diabetes Mellitus','{"icd10Prefixes":["E10","E11","E12","E13","E14"],"minEncounters":2,"withinDays":365}'),
  (gen_random_uuid()::TEXT,'oncology','Oncology (Cancer)','{"icd10Prefixes":["C"],"minEncounters":1,"withinDays":730}'),
  (gen_random_uuid()::TEXT,'cardiac','Cardiac Disease','{"icd10Prefixes":["I20","I21","I22","I25","I50"],"minEncounters":2,"withinDays":365}'),
  (gen_random_uuid()::TEXT,'asthma','Asthma','{"icd10Prefixes":["J45","J46"],"minEncounters":2,"withinDays":365}');

CREATE TABLE "member_chronic_statuses" (
  "id"              TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "memberNumber"    TEXT NOT NULL,
  "conditionCode"   TEXT NOT NULL,
  "confidence"      DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastObservedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status"          TEXT NOT NULL DEFAULT 'active',
  CONSTRAINT "member_chronic_statuses_conditionCode_fkey"
    FOREIGN KEY ("conditionCode") REFERENCES "chronic_conditions"("code"),
  CONSTRAINT "member_chronic_statuses_memberNumber_conditionCode_unique"
    UNIQUE ("memberNumber","conditionCode")
);
CREATE INDEX "member_chronic_statuses_memberNumber_idx" ON "member_chronic_statuses"("memberNumber");
CREATE INDEX "member_chronic_statuses_conditionCode_idx" ON "member_chronic_statuses"("conditionCode");
CREATE INDEX "member_chronic_statuses_status_idx" ON "member_chronic_statuses"("status");
