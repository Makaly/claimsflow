-- E4: Feature flags table
CREATE TABLE "feature_flags" (
    "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
    "key"         TEXT        NOT NULL,
    "description" TEXT,
    "enabled"     BOOLEAN     NOT NULL DEFAULT false,
    -- targeting_jsonb: { percentage?: number, roles?: string[], provider_ids?: string[], user_ids?: string[] }
    "targeting_jsonb" JSONB   NOT NULL DEFAULT '{}',
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feature_flags_key_key" UNIQUE ("key")
);

CREATE INDEX "feature_flags_key_idx" ON "feature_flags"("key");
CREATE INDEX "feature_flags_enabled_idx" ON "feature_flags"("enabled");
