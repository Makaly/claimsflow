-- F4: Workflow definitions for the visual designer.
CREATE TABLE "workflow_definitions" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "name"       TEXT        NOT NULL,
    "version"    INTEGER     NOT NULL DEFAULT 1,
    -- dsl_jsonb: { steps: [{ id, kind, sla_hours, branch_rule }] }
    "dsl_jsonb"  JSONB       NOT NULL DEFAULT '{"steps":[]}',
    "status"     TEXT        NOT NULL DEFAULT 'draft',   -- draft|published|archived
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "workflow_definitions_pkey"          PRIMARY KEY ("id"),
    CONSTRAINT "workflow_definitions_status_check"  CHECK ("status" IN ('draft','published','archived'))
);

-- Only one definition can be 'published' at a time for a given name.
CREATE UNIQUE INDEX "workflow_definitions_published_name_idx"
    ON "workflow_definitions"("name")
    WHERE "status" = 'published';

CREATE INDEX "workflow_definitions_status_idx"  ON "workflow_definitions"("status");
CREATE INDEX "workflow_definitions_name_idx"    ON "workflow_definitions"("name");
