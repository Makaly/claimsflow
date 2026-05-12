import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacService } from '../rbac.service';
import {
  PERMISSIONS_KEY,
  PERMISSIONS_MODE_KEY,
} from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const mode = this.reflector.getAllAndOverride<'all' | 'any'>(
      PERMISSIONS_MODE_KEY,
      [context.getHandler(), context.getClass()],
    ) ?? 'all';

    const req = context.switchToHttp().getRequest();
    const userId: string | undefined = req.user?.userId;
    if (!userId) throw new ForbiddenException('Not authenticated');

    // Cache on the request object so multiple guards on the same request don't
    // issue duplicate DB queries.
    if (!req.user.permissions) {
      req.user.permissions = await this.rbac.getUserPermissions(userId);
    }
    const owned: string[] = req.user.permissions;

    const ok =
      mode === 'any'
        ? required.some((p) => owned.includes(p))
        : required.every((p) => owned.includes(p));

    if (!ok) {
      throw new ForbiddenException(
        `Missing required permission${required.length > 1 ? 's' : ''}: ${required.join(', ')}`,
      );
    }
    return true;
  }
}
