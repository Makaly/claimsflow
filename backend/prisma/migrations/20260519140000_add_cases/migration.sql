-- F1: Case management tables

CREATE TABLE "cases" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "claim_id"   UUID        NOT NULL,
    "owner_id"   UUID,
    "status"     TEXT        NOT NULL DEFAULT 'open',   -- open|on-hold|resolved|escalated
    "sla_due_at" TIMESTAMPTZ,
    "opened_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "closed_at"  TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cases_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE,
    CONSTRAINT "cases_owner_id_fkey" FOREIGN KEY ("owner_id")  REFERENCES "users"("id")  ON DELETE SET NULL,
    CONSTRAINT "cases_status_check"  CHECK ("status" IN ('open','on-hold','resolved','escalated'))
);

CREATE INDEX "cases_claim_id_idx"  ON "cases"("claim_id");
CREATE INDEX "cases_owner_id_idx"  ON "cases"("owner_id");
CREATE INDEX "cases_status_idx"    ON "cases"("status");
CREATE INDEX "cases_sla_due_at_idx" ON "cases"("sla_due_at");

CREATE TABLE "case_comments" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "case_id"    UUID        NOT NULL,
    "author_id"  UUID,
    "body"       TEXT        NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "case_comments_pkey"    PRIMARY KEY ("id"),
    CONSTRAINT "case_comments_case_fk" FOREIGN KEY ("case_id")   REFERENCES "cases"("id") ON DELETE CASCADE,
    CONSTRAINT "case_comments_user_fk" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "case_comments_case_id_idx" ON "case_comments"("case_id");
CREATE INDEX "case_comments_created_at_idx" ON "case_comments"("created_at" DESC);

CREATE TABLE "case_links" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "case_id"    UUID        NOT NULL,
    "type"       TEXT        NOT NULL,   -- appeal|fraud_verdict|document|claim
    "target_id"  TEXT        NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "case_links_pkey"    PRIMARY KEY ("id"),
    CONSTRAINT "case_links_case_fk" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE
);

CREATE INDEX "case_links_case_id_idx" ON "case_links"("case_id");
