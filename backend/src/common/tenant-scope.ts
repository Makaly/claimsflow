/**
 * Phase 4 — multi-tenant scaffolding.
 *
 * Returns a Prisma `where` fragment that scopes a query to the caller's
 * tenant. When the caller has no tenantId on their JWT (legacy single-org
 * users), returns `{}` so the query is unchanged — backwards compatible by
 * design until a future migration backfills tenantId everywhere and tightens
 * the column to NOT NULL.
 *
 * Usage:
 *   await prisma.document.findMany({
 *     where: { ...tenantScope(req.user), claimId },
 *   });
 */

export interface UserWithTenant {
  tenantId?: string | null;
}

/**
 * The canonical helper. Pass it the JWT user; spread the result into the
 * Prisma `where` clause. Safe to call with undefined.
 */
export function tenantScope(user?: UserWithTenant | null): { tenantId?: string } {
  if (!user || !user.tenantId) return {};
  return { tenantId: user.tenantId };
}

/**
 * Variant for queries that don't have a direct tenantId column but join to
 * a parent that does — e.g. DocumentAnnotation has no tenantId, but its
 * parent document does. Pass the parent relation name:
 *
 *   await prisma.documentAnnotation.findMany({
 *     where: { ...tenantScopeOnRelation('document', req.user), documentId },
 *   });
 */
export function tenantScopeOnRelation(
  relation: string,
  user?: UserWithTenant | null,
): Record<string, unknown> {
  if (!user || !user.tenantId) return {};
  return { [relation]: { tenantId: user.tenantId } };
}
