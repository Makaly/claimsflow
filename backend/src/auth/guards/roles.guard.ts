import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    // Check against the full RBAC roles array first, then fall back to the
    // legacy single-role field so both authorization paths are honoured.
    const userRoles: string[] = Array.isArray(user.roles) ? user.roles : [];
    if (user.role && !userRoles.includes(user.role)) userRoles.push(user.role);

    return requiredRoles.some((r) => userRoles.includes(r));
  }
}
