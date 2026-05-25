-- v2-T4.3: pg_trgm extension + GIN indexes for fuzzy search
-- Enables the % (similarity) and <-> (word similarity) operators on text columns.
-- prevents table locks during index build.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Fuzzy search on claim number (e.g. "CF-2026-00" → partial match)
CREATE INDEX IF NOT EXISTS "claims_claimnumber_trgm_idx"
  ON "claims" USING GIN ("claimNumber" gin_trgm_ops);

-- Fuzzy search on member name (common misspelling / OCR noise scenario)
CREATE INDEX IF NOT EXISTS "claims_membername_trgm_idx"
  ON "claims" USING GIN ("memberName" gin_trgm_ops);

-- Fuzzy search on provider name
CREATE INDEX IF NOT EXISTS "providers_name_trgm_idx"
  ON "providers" USING GIN ("name" gin_trgm_ops);

-- The GIN indexes accelerate ILIKE queries used by Prisma's contains/insensitive.
-- For direct % similarity use, call via $queryRaw in ClaimsService:
--   SELECT * FROM claims WHERE claimNumber % $1 OR "memberName" % $1 ORDER BY ...
-- The similarity threshold can be tuned per-session: SET pg_trgm.similarity_threshold = 0.3;

