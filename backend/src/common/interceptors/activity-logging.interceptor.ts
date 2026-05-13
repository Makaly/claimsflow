import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ActivityLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ActivityLoggingInterceptor.name);

  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const { method, url, body, user, ip, headers } = request;
    const userAgent = headers['user-agent'] || 'Unknown';

    const startTime = Date.now();

    // Determine action type from HTTP method and URL
    const action = this.determineAction(method, url);
    const entityType = this.extractEntityType(url);

    return next.handle().pipe(
      tap(async (responseData) => {
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode;

        // Skip logging for certain endpoints (health checks, metrics, etc.)
        if (this.shouldSkipLogging(url)) {
          return;
        }

        try {
          await this.logActivity({
            userId: user?.userId || null,
            action,
            entityType,
            entityId: this.extractEntityId(url, responseData),
            method,
            url,
            statusCode,
            duration,
            ipAddress: this.getClientIp(request),
            userAgent,
            requestBody: this.sanitizeRequestBody(body),
            responseStatus: 'success',
          });
        } catch (error) {
          this.logger.error('Failed to log activity', error);
        }
      }),
      catchError(async (error) => {
        const duration = Date.now() - startTime;
        const statusCode = error.status || 500;

        try {
          await this.logActivity({
            userId: user?.userId || null,
            action,
            entityType,
            entityId: null,
            method,
            url,
            statusCode,
            duration,
            ipAddress: this.getClientIp(request),
            userAgent,
            requestBody: this.sanitizeRequestBody(body),
            responseStatus: 'error',
            errorMessage: error.message,
          });
        } catch (logError) {
          this.logger.error('Failed to log error activity', logError);
        }

        throw error;
      }),
    );
  }

  /**
   * Log activity to database
   */
  private async logActivity(data: {
    userId: string | null;
    action: string;
    entityType: string | null;
    entityId: string | null;
    method: string;
    url: string;
    statusCode: number;
    duration: number;
    ipAddress: string;
    userAgent: string;
    requestBody: any;
    responseStatus: string;
    errorMessage?: string;
  }) {
    try {
      await this.prisma.activityLog.create({
        data: {
          action: data.action,
          entity: data.entityType,
          entityId: data.entityId,
          metadata: {
            method: data.method,
            url: data.url,
            statusCode: data.statusCode,
            duration: data.duration,
            requestBody: data.requestBody,
            responseStatus: data.responseStatus,
            errorMessage: data.errorMessage,
          },
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          status: 'success',
          ...(data.userId ? { user: { connect: { id: data.userId } } } : {}),
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create activity log: ${error.message}`);
    }
  }

  /**
   * Determine action from HTTP method and URL
   */
  private determineAction(method: string, url: string): string {
    const urlLower = url.toLowerCase();

    // Authentication actions
    if (urlLower.includes('/auth/login')) return 'login';
    if (urlLower.includes('/auth/logout')) return 'logout';
    if (urlLower.includes('/auth/register')) return 'register';
    if (urlLower.includes('/auth/2fa')) return '2fa_action';

    // Claim actions
    if (urlLower.includes('/claims')) {
      if (method === 'POST' && urlLower.includes('/approve')) return 'claim_approved';
      if (method === 'POST' && urlLower.includes('/reject')) return 'claim_rejected';
      if (method === 'POST') return 'claim_created';
      if (method === 'PATCH' || method === 'PUT') return 'claim_updated';
      if (method === 'DELETE') return 'claim_deleted';
      if (method === 'GET') return 'claim_viewed';
    }

    // Provider actions
    if (urlLower.includes('/providers')) {
      if (method === 'POST' && urlLower.includes('/approve')) return 'provider_approved';
      if (method === 'POST' && urlLower.includes('/reject')) return 'provider_rejected';
      if (method === 'POST' && urlLower.includes('/suspend')) return 'provider_suspended';
      if (method === 'POST') return 'provider_created';
      if (method === 'PATCH' || method === 'PUT') return 'provider_updated';
      if (method === 'DELETE') return 'provider_deleted';
    }

    // Batch submission actions
    if (urlLower.includes('/batch-submissions')) {
      if (method === 'POST') return 'batch_uploaded';
      if (method === 'GET') return 'batch_viewed';
    }

    // Workflow actions
    if (urlLower.includes('/workflow')) {
      if (urlLower.includes('/maker/approve')) return 'maker_approved';
      if (urlLower.includes('/maker/reject')) return 'maker_rejected';
      if (urlLower.includes('/checker/approve')) return 'checker_approved';
      if (urlLower.includes('/checker/reject')) return 'checker_rejected';
      if (urlLower.includes('/assign')) return 'claim_assigned';
    }

    // Document actions
    if (urlLower.includes('/documents')) {
      if (urlLower.includes('/annotations') && method === 'POST') return 'annotation_created';
      if (urlLower.includes('/annotations') && method === 'PATCH') return 'annotation_updated';
      if (urlLower.includes('/annotations') && method === 'DELETE') return 'annotation_deleted';
      if (method === 'POST') return 'document_uploaded';
      if (method === 'DELETE') return 'document_deleted';
      if (method === 'GET') return 'document_viewed';
    }

    // Default actions based on HTTP method
    switch (method) {
      case 'POST':
        return 'create';
      case 'GET':
        return 'read';
      case 'PATCH':
      case 'PUT':
        return 'update';
      case 'DELETE':
        return 'delete';
      default:
        return 'unknown';
    }
  }

  /**
   * Extract entity type from URL
   */
  private extractEntityType(url: string): string | null {
    const patterns = [
      { pattern: /\/claims/i, type: 'claim' },
      { pattern: /\/providers/i, type: 'provider' },
      { pattern: /\/documents/i, type: 'document' },
      { pattern: /\/batch-submissions/i, type: 'batch' },
      { pattern: /\/users/i, type: 'user' },
      { pattern: /\/workflow/i, type: 'workflow' },
    ];

    for (const { pattern, type } of patterns) {
      if (pattern.test(url)) {
        return type;
      }
    }

    return null;
  }

  /**
   * Extract entity ID from URL or response
   */
  private extractEntityId(url: string, responseData: any): string | null {
    // Try to extract ID from URL (e.g., /claims/123)
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = url.match(uuidPattern);
    if (match) {
      return match[0];
    }

    // Try to extract ID from response
    if (responseData && typeof responseData === 'object') {
      return responseData.id || responseData.claimId || responseData.providerId || null;
    }

    return null;
  }

  /**
   * Get client IP address
   */
  private getClientIp(request: any): string {
    return (
      request.headers['x-forwarded-for']?.split(',')[0] ||
      request.headers['x-real-ip'] ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      'unknown'
    );
  }

  /**
   * Sanitize request body (remove sensitive data).
   *
   * Activity logs are queried by support and may be exported, so this list
   * is intentionally broad and the walk is recursive so nested shapes like
   * `{ user: { password } }` are redacted too. Match is case-insensitive
   * and substring-based (`twoFactorSecret`, `twoFactorCode`, `accessToken`
   * all match).
   */
  private static readonly SENSITIVE_KEY_PATTERNS = [
    'password',
    'currentpassword',
    'newpassword',
    'token',
    'secret',
    'apikey',
    'authorization',
    'cookie',
    'creditcard',
    'cvv',
    'pin',
    'otp',
    'backupcode',
    'twofactor',
    'mfa',
    'signature',
  ];

  private sanitizeRequestBody(body: any, depth = 0): any {
    // Cap recursion so a circular or pathologically deep body can't hang us.
    if (depth > 6) return '[TRUNCATED]';
    if (body == null) return body;
    if (Array.isArray(body)) return body.map((v) => this.sanitizeRequestBody(v, depth + 1));
    if (typeof body !== 'object') return body;

    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(body)) {
      const k = key.toLowerCase();
      const isSensitive = ActivityLoggingInterceptor.SENSITIVE_KEY_PATTERNS.some(
        (p) => k.includes(p),
      );
      if (isSensitive) {
        out[key] = '[REDACTED]';
      } else if (value && typeof value === 'object') {
        out[key] = this.sanitizeRequestBody(value, depth + 1);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  /**
   * Determine if logging should be skipped for this URL
   */
  private shouldSkipLogging(url: string): boolean {
    const skipPatterns = [
      /\/health/i,
      /\/metrics/i,
      /\/favicon.ico/i,
      /\/static/i,
    ];

    return skipPatterns.some((pattern) => pattern.test(url));
  }
}
