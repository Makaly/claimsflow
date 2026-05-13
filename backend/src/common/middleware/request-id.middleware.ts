import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';

const HEADER = 'x-request-id';

// Stamps every request with an X-Request-ID (accepts a caller-supplied one
// if present, otherwise generates a UUID v4). The id is mirrored back in
// the response header and stashed on `req.requestId` so the exception
// filter and logging interceptor can include it in their output.
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const incoming = req.headers[HEADER];
    const id =
      typeof incoming === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(incoming)
        ? incoming
        : randomUUID();
    req.requestId = id;
    res.setHeader('X-Request-ID', id);
    next();
  }
}
