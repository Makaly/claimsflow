# Multi-Tenancy Roadmap

## Current state (E5 groundwork — 2026-05-19)

- `tenants` table with `slug`, `name`, `branding_jsonb`, `active`.
- Nullable `tenant_id` FK added to: `users`, `providers`, `claims`, `documents`,
  `payment_advices`, `activity_logs`. Default `NULL` = the existing single-tenant
  "default" environment — no behaviour change for current data.
- `TenantMiddleware` resolves the tenant from the `X-Tenant-Slug` request header
  and stores it in a REQUEST-scoped `TenantContextService`.

## Phase 2 — Row-level isolation (Q3 2026)

Inject `TenantContextService` into each service and add `tenantId` to every
`prisma.<model>.findMany/findUnique` where clause. Use Prisma middleware to enforce
this automatically rather than relying on per-service discipline:

```typescript
prisma.$use(async (params, next) => {
  if (tenantId && params.model && TENANT_SCOPED_MODELS.includes(params.model)) {
    params.args.where = { ...params.args.where, tenantId };
  }
  return next(params);
});
```

## Phase 3 — Schema-per-tenant (Q4 2026, if required)

If row-level isolation is insufficient (e.g. regulatory data residency requirements),
migrate to separate Postgres schemas using Prisma's `previewFeatures = ["multiSchema"]`.
Each tenant gets its own schema; the shared `tenants` catalogue lives in `public`.

## Branding

`branding_jsonb` shape: `{ logoUrl?: string, primaryColor?: string, companyName?: string }`.
The frontend reads `/api/tenants/current` (TODO: implement) and applies the brand
tokens via CSS custom properties.
