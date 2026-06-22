import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { MeteringService } from './metering.service';
import { METER_KEY } from './decorators';
import { MetricKey } from './plans';

/**
 * Records metered usage AFTER a handler succeeds, so failed/validation-error
 * requests never consume quota. Pair with @Meter(metric) on the route.
 *
 * Fire-and-forget relative to the response (metering must never break a
 * successful write); failures are swallowed. For exact billing, reconcile from
 * source tables (Claim, OcrExtraction) — these counters are the fast path, not
 * the book of record.
 */
@Injectable()
export class UsageMeterInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly metering: MeteringService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const metric = this.reflector.getAllAndOverride<MetricKey>(METER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!metric) return next.handle();

    const req = context.switchToHttp().getRequest();
    const tenantId: string | null = req.user?.tenantId ?? null;

    return next.handle().pipe(
      tap(() => {
        void this.metering.recordUsage(tenantId, metric, 1).catch(() => undefined);
      }),
    );
  }
}
