import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MeteringService } from './metering.service';
import { ENTITLEMENT_KEY, METER_KEY, PLAN_LEVEL_KEY } from './decorators';
import { MetricKey, PLAN_LEVEL, PlanId } from './plans';

/**
 * Enforces the three declarative gates on a route:
 *  - @RequiresEntitlement(feature) → 403 if the tenant's plan lacks it.
 *  - @RequiresPlan(plan)           → 403 PLAN_UPGRADE_REQUIRED if the tenant's
 *    plan tier ranks below the required one (route-level feature gating).
 *  - @Meter(metric)                → 402 if over quota AND enforcement='enforce'
 *    ('report' mode never blocks — internal/trial). The actual increment happens
 *    in UsageMeterInterceptor (post-success), so a failed request burns no quota.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly metering: MeteringService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<string>(ENTITLEMENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredPlan = this.reflector.getAllAndOverride<PlanId>(PLAN_LEVEL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const metric = this.reflector.getAllAndOverride<MetricKey>(METER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature && !requiredPlan && !metric) return true;

    const req = context.switchToHttp().getRequest();
    const tenantId: string | null = req.user?.tenantId ?? null;
    const ent = await this.metering.resolve(tenantId);

    if (requiredPlan) {
      const have = PLAN_LEVEL[ent.plan] ?? 0;
      const need = PLAN_LEVEL[requiredPlan] ?? 0;
      if (have < need) {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          error: 'PLAN_UPGRADE_REQUIRED',
          message: `This feature requires the ${requiredPlan} plan. Your current plan is ${ent.plan}.`,
          currentPlan: ent.plan,
          requiredPlan,
        });
      }
    }

    if (feature && !ent.features.has(feature)) {
      throw new ForbiddenException(
        `'${feature}' is not included in your plan. Contact your administrator to upgrade.`,
      );
    }

    if (metric) {
      const quota = await this.metering.checkQuota(tenantId, metric);
      if (quota.block) {
        throw new HttpException(
          {
            statusCode: HttpStatus.PAYMENT_REQUIRED,
            error: 'Quota exceeded',
            message: `Monthly ${metric} limit reached (${quota.used}/${quota.limit}). Upgrade your plan or wait for the next billing period.`,
            metric,
            used: quota.used,
            limit: quota.limit,
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    }

    return true;
  }
}
