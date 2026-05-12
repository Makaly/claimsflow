import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditActor {
  userId?: string | null;
  role?: string | null;
  email?: string | null;
  name?: string | null;
  providerId?: string | null;
  branchId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry {
  actor?: AuditActor;
  action: string;
  entity: string;
  entityId: string;
  oldValue?: any;
  newValue?: any;
  metadata?: Record<string, any>;
  status?: 'success' | 'failure';
  errorMessage?: string;
}

const SENSITIVE_KEYS = new Set(['password', 'token', 'secret', 'apiKey', 'creditCard']);

function sanitize(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value !== 'object') return value;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : sanitize(v);
  }
  return out;
}

function diff(before: any, after: any): { oldValue: any; newValue: any } | null {
  if (!before && !after) return null;
  if (!before) return { oldValue: null, newValue: sanitize(after) };
  if (!after) return { oldValue: sanitize(before), newValue: null };

  const changed: Record<string, any> = {};
  const previous: Record<string, any> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const a = (before as any)[key];
    const b = (after as any)[key];
    const serializedA = JSON.stringify(a);
    const serializedB = JSON.stringify(b);
    if (serializedA !== serializedB) {
      previous[key] = sanitize(a);
      changed[key] = sanitize(b);
    }
  }
  if (Object.keys(changed).length === 0) return null;
  return { oldValue: previous, newValue: changed };
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Record an audit entry. Never throws — audit failure must not break the caller.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      const actor = entry.actor || {};
      let username: string | null = null;
      let userRole: string | null = null;

      if (actor.userId) {
        const user = await this.prisma.user.findUnique({
          where: { id: actor.userId },
          select: { name: true, role: true },
        });
        username = user?.name ?? null;
        userRole = user?.role ?? null;
      }

      await this.prisma.activityLog.create({
        data: {
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId,
          userId: actor.userId ?? null,
          username,
          userRole,
          ipAddress: actor.ipAddress ?? null,
          userAgent: actor.userAgent ?? null,
          oldValue: entry.oldValue ? sanitize(entry.oldValue) : undefined,
          newValue: entry.newValue ? sanitize(entry.newValue) : undefined,
          metadata: entry.metadata ?? undefined,
          status: entry.status ?? 'success',
          errorMessage: entry.errorMessage,
        },
      });
    } catch (err: any) {
      this.logger.error(`Audit write failed: ${err?.message}`);
    }
  }

  /**
   * Compute a diff of two entity snapshots and record it. If nothing changed,
   * no entry is written.
   */
  async recordChange(params: {
    actor?: AuditActor;
    action: string;
    entity: string;
    entityId: string;
    before: any;
    after: any;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const d = diff(params.before, params.after);
    if (!d) return;
    await this.record({
      actor: params.actor,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      oldValue: d.oldValue,
      newValue: d.newValue,
      metadata: params.metadata,
    });
  }
}
