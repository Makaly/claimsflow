import { Injectable, Scope } from '@nestjs/common';

/**
 * REQUEST-scoped service: one instance per HTTP request.
 * Populated by TenantMiddleware from the X-Tenant-Slug header.
 * Defaults to null (the "default" tenant — existing single-tenant behaviour).
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  private _tenantId: string | null = null;
  private _slug: string | null = null;

  set(tenantId: string | null, slug: string | null) {
    this._tenantId = tenantId;
    this._slug = slug;
  }

  get tenantId() { return this._tenantId; }
  get slug() { return this._slug; }
}
