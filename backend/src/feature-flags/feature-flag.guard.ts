import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagsService } from './feature-flags.service';
import { FEATURE_FLAG_KEY } from './feature-flag.decorator';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private flags: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(FEATURE_FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!key) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user;

    const enabled = await this.flags.isEnabled(key, {
      userId: user?.userId,
      role: user?.role,
      providerId: user?.providerId,
    });

    if (!enabled) throw new ForbiddenException(`Feature '${key}' is not enabled`);
    return true;
  }
}
