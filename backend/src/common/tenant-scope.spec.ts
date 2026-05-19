import { tenantScope, tenantScopeOnRelation } from './tenant-scope';

describe('tenantScope', () => {
  it('returns {} when user is undefined (anonymous / system caller)', () => {
    expect(tenantScope(undefined)).toEqual({});
  });

  it('returns {} when user is null', () => {
    expect(tenantScope(null)).toEqual({});
  });

  it('returns {} when user has no tenantId (legacy single-org user)', () => {
    expect(tenantScope({ tenantId: null })).toEqual({});
    expect(tenantScope({ tenantId: undefined })).toEqual({});
    expect(tenantScope({})).toEqual({});
  });

  it('returns { tenantId } when user has one — usable as a Prisma where fragment', () => {
    expect(tenantScope({ tenantId: 'tenant-cic' })).toEqual({ tenantId: 'tenant-cic' });
  });

  it('does not leak unrelated fields from the user object', () => {
    const out = tenantScope({ tenantId: 'tenant-cic', role: 'admin', providerId: 'p-1' } as any);
    expect(out).toEqual({ tenantId: 'tenant-cic' });
    expect((out as any).role).toBeUndefined();
    expect((out as any).providerId).toBeUndefined();
  });
});

describe('tenantScopeOnRelation', () => {
  it('returns {} for legacy users without a tenantId', () => {
    expect(tenantScopeOnRelation('document', undefined)).toEqual({});
    expect(tenantScopeOnRelation('document', { tenantId: null })).toEqual({});
  });

  it('nests the tenantId filter under the named relation', () => {
    expect(tenantScopeOnRelation('document', { tenantId: 'tenant-cic' })).toEqual({
      document: { tenantId: 'tenant-cic' },
    });
  });

  it('supports arbitrary relation names (no hard-coded model list)', () => {
    expect(tenantScopeOnRelation('claim', { tenantId: 't1' })).toEqual({
      claim: { tenantId: 't1' },
    });
    expect(tenantScopeOnRelation('provider', { tenantId: 't1' })).toEqual({
      provider: { tenantId: 't1' },
    });
  });
});
