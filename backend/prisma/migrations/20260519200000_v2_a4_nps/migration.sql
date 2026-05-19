-- A4: NPS responses table
CREATE TABLE "nps_responses" (
    "id"              TEXT NOT NULL,
    "claimId"         TEXT,
    "memberId"        TEXT,
    "score"           INTEGER NOT NULL,
    "comment"         TEXT,
    "channel"         TEXT NOT NULL DEFAULT 'in_app',
    "claimType"       TEXT,
    "providerId"      TEXT,
    "rejectionReason" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nps_responses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "nps_responses_claimId_idx"    ON "nps_responses"("claimId");
CREATE INDEX "nps_responses_memberId_idx"   ON "nps_responses"("memberId");
CREATE INDEX "nps_responses_createdAt_idx"  ON "nps_responses"("createdAt");
CREATE INDEX "nps_responses_score_idx"      ON "nps_responses"("score");
