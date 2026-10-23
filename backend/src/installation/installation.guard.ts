import { CanActivate, ExecutionContext, ForbiddenException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InstallationService } from './installation.service';

/**
 * Global lockout guard (E8). When this node is managed (LICENSE_SERVER_URL set)
 * and its lease has lapsed/been revoked, EVERY route is blocked with 403
 * INSTALLATION_LOCKED — full lockout — except a small allowlist so the admin can
 * still reach the reactivation screen and the install can phone home:
 *   /api/installation/*   (status, activate, heartbeat-now)
 *   /api/health, /api/ready, /api
 *
 * Standalone nodes (no server configured) are never locked. Result is cached
 * briefly so this doesn't hit the DB on every request.
 */
@Injectable()
export class InstallationGuard implements CanActivate {
  private readonly logger = new Logger(InstallationGuard.name);
  private cached?: { locked: boolean; at: number };
  private readonly ttlMs = 30_000;

  private static readonly ALLOW = [
    /^\/api\/installation(\/|$)/,
    /^\/api\/(health|ready)(\/|$)/,
    /^\/api\/?$/,
  ];

  constructor(private readonly installation: InstallationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.installation.isManaged()) return true;

    const req = context.switchToHttp().getRequest();
    const path: string = req.path || req.url || '';
    if (InstallationGuard.ALLOW.some((re) => re.test(path))) return true;

    const now = Date.now();
    if (!this.cached || now - this.cached.at > this.ttlMs) {
      this.cached = { locked: await this.installation.isLocked(), at: now };
    }
    if (this.cached.locked) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        error: 'INSTALLATION_LOCKED',
        message:
          'This installation could not validate its licence with the licensing server within the required window. ' +
          'Connect it to the internet and re-activate to restore access.',
      });
    }
    return true;
  }

  /** Let mutations (activate/heartbeat) clear the cache so the lock lifts immediately. */
  invalidate() {
    this.cached = undefined;
  }
}
