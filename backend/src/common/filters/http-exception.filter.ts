import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

// Stable error envelope: { statusCode, code, message, requestId, timestamp }.
// 4xx responses surface the validation/business message; 5xx responses log
// the underlying error server-side and return a generic message to the
// client so we don't leak Prisma constraint names, stack frames, or other
// internals.
@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<any>();
    const res = ctx.getResponse<any>();

    const requestId: string | undefined = req?.requestId;
    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? (exception as HttpException).getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let code = isHttp ? this.codeFromStatus(status) : 'INTERNAL_ERROR';
    let message: string | string[] = 'Internal server error';
    let details: unknown = undefined;

    if (isHttp) {
      const response = (exception as HttpException).getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object') {
        const r = response as Record<string, any>;
        message = r.message ?? message;
        if (typeof r.error === 'string') code = this.normaliseCode(r.error);
        details = r.details;
      }
    } else if (exception instanceof Error) {
      // Don't echo the underlying message — Prisma errors expose schema.
      this.logger.error(
        `[${requestId ?? '-'}] ${req?.method} ${req?.url} 5xx: ${exception.message}`,
        exception.stack,
      );
    } else {
      this.logger.error(
        `[${requestId ?? '-'}] ${req?.method} ${req?.url} 5xx (non-Error thrown)`,
        String(exception),
      );
    }

    // Even for handled 4xx, log a brief line so audit + ops can correlate.
    if (status >= 500) {
      // already logged above
    } else if (status >= 400) {
      this.logger.warn(
        `[${requestId ?? '-'}] ${req?.method} ${req?.url} ${status} ${
          Array.isArray(message) ? message.join('; ') : message
        }`,
      );
    }

    res.status(status).json({
      statusCode: status,
      code,
      message,
      details,
      requestId,
      timestamp: new Date().toISOString(),
      path: req?.url,
    });
  }

  private codeFromStatus(status: number): string {
    switch (status) {
      case 400: return 'BAD_REQUEST';
      case 401: return 'UNAUTHORIZED';
      case 403: return 'FORBIDDEN';
      case 404: return 'NOT_FOUND';
      case 409: return 'CONFLICT';
      case 413: return 'PAYLOAD_TOO_LARGE';
      case 422: return 'UNPROCESSABLE_ENTITY';
      case 429: return 'TOO_MANY_REQUESTS';
      default:  return status >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
    }
  }

  private normaliseCode(s: string): string {
    return s.toUpperCase().replace(/\s+/g, '_');
  }
}
