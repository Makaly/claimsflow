import { SetMetadata } from '@nestjs/common';
import { FeatureKey, MetricKey, PlanId } from './plans';

export const ENTITLEMENT_KEY = 'required_entitlement';
export const METER_KEY = 'metered_resource';
export const PLAN_LEVEL_KEY = 'required_plan';

/**
 * Gate a route on a licensed feature. Requires EntitlementGuard on the route.
 * Denied → 403 "not included in your plan".
 *
 *   @RequiresEntitlement(FEATURES.FRAUD_SCORING)
 */
export const RequiresEntitlement = (feature: FeatureKey | string) =>
  SetMetadata(ENTITLEMENT_KEY, feature);

/**
 * Mark a route as consuming a metered resource. EntitlementGuard pre-checks the
 * quota (blocks with 402 only in 'enforce' mode); UsageMeterInterceptor records
 * the usage AFTER the handler succeeds.
 *
 *   @Meter(METRICS.CLAIMS)
 */
export const Meter = (metric: MetricKey | string) => SetMetadata(METER_KEY, metric);

/**
 * Gate a route (or whole controller) on a minimum plan tier. The FeatureGate
 * guard compares the tenant's PLAN_LEVEL to the required one; below it → 403
 * PLAN_UPGRADE_REQUIRED. This is the NestJS-decorator analogue of helpdesk's
 * route-prefix featureGate.
 *
 *   @RequiresPlan('pro')
 */
export const RequiresPlan = (plan: PlanId) => SetMetadata(PLAN_LEVEL_KEY, plan);
