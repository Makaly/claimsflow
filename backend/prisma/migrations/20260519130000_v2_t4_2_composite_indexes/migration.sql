-- v2-T4.2: Composite indexes on hot query paths
-- These cover the three most common multi-column WHERE/ORDER BY patterns seen
-- in production explain plans: claim queue filtering, provider claim timeline,
-- and activity-log entity lookup.

-- Claim queue: filtered by status + assignedTo + ordered by createdAt
CREATE INDEX CONCURRENTLY IF NOT EXISTS "claims_status_assigned_created_idx"
  ON "claims" ("status", "assignedTo", "createdAt" DESC);

-- Provider claims timeline: filtered by providerId + ordered by createdAt
CREATE INDEX CONCURRENTLY IF NOT EXISTS "claims_provider_created_idx"
  ON "claims" ("providerId", "createdAt" DESC);

-- Activity log entity lookup: filtered by entity (type) + entityId + ordered by createdAt
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activity_logs_entity_created_idx"
  ON "activity_logs" ("entity", "entityId", "createdAt" DESC);
