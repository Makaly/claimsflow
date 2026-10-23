import { CanActivate, ExecutionContext, ForbiddenException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { LicenseService } from './license.service';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Read-only / paused enforcement (mirrors helpdesk `licenseGuard`). Attach to
 * write-heavy controllers AFTER JwtAuthGuard.
 *
 *  - SUSPENDED (paused subscription): blocks ALL methods → 403 SUBSCRIPTION_PAUSED.
 *  - EXPIRED (past grace): reads (GET/HEAD/OPTIONS) pass; writes → 403 LICENSE_EXPIRED.
 *
 * So "read-only" means: view everything, mutate nothing. Tenant-less (internal)
 * requests pass, and the guard FAILS OPEN on error — availability over strictness.
 */
@Injectable()
export class LicenseGuard implements CanActivate {
  private readonly logger = new Logger(LicenseGuard.name);

  constructor(private readonly licenses: LicenseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const tenantId: string | null = req.user?.tenantId ?? null;
    if (!tenantId) return true; // internal / single-tenant default

    try {
      const info = await this.licenses.getLicenseInfo(tenantId);
      const method = (req.method ?? 'GET').toUpperCase();

      if (info.isPaused) {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          error: 'SUBSCRIPTION_PAUSED',
          message: 'Your subscription is paused. Resume it to continue using ClaimsFlow.',
        });
      }

      if (info.isReadOnly && !READ_METHODS.has(method)) {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          error: 'LICENSE_EXPIRED',
          message:
            info.licenseType === 'TRIAL'
              ? 'Your trial has ended. Upgrade to a paid plan to keep working.'
              : 'Your licence has expired. Renew it to restore write access. Existing data remains viewable.',
          licenseType: info.licenseType,
          expiredOn: info.licenseExpiryDate,
        });
      }

      return true;
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      this.logger.warn(`LicenseGuard failed for tenant ${tenantId}; failing open: ${(e as Error).message}`);
      return true;
    }
  }
}
