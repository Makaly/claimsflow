import { bootstrapTelemetry } from './telemetry/telemetry';
// Telemetry must be the first thing that runs so auto-instrumentation patches
// http/pg/redis before NestFactory loads any module.
bootstrapTelemetry();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import * as fs from 'fs';
import { AppModule } from './app.module';

// Allow BigInt values in JSON responses (Prisma returns BigInt for size fields).
// Serialise as a string, not Number — Number silently truncates anything above
// 2^53-1, which would corrupt large size/byte fields or any future BIGINT
// monetary column. Frontend types for these fields must be `string`.
;(BigInt.prototype as any).toJSON = function () { return this.toString() }

async function bootstrap() {
  console.log('[bootstrap] creating Nest application…');
  const app = await NestFactory.create(AppModule, {
    // Pipe Nest's logger through console so Render captures it the same way
    // it captures our explicit console.log calls (stdout, line-buffered).
    bufferLogs: false,
  });
  console.log('[bootstrap] Nest application created');

  // Security headers — must be applied before CORS and body parsers.
  // HSTS is enabled only in production so local HTTP development is not pinned
  // to HTTPS in browsers that have visited the dev origin.
  const isProd = process.env.NODE_ENV === 'production';
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [])],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    // GDPR Art. 32 — encryption in transit. One year, all subdomains, preload-eligible.
    hsts: isProd
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

  // Permissions-Policy — disable browser features we don't use. Helmet 7
  // doesn't set this by default, so apply it as a small middleware.
  app.use((_req: any, res: any, next: any) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    next();
  });

  // Cookie parser — required for HttpOnly JWT cookie extraction
  app.use(cookieParser());

  // Increase JSON body limit so profile updates with avatarUrl base64 don't 413
  app.use(require('express').json({ limit: '10mb' }))
  app.use(require('express').urlencoded({ limit: '10mb', extended: true }))

  // Global prefix
  app.setGlobalPrefix(process.env.API_PREFIX || 'api');

  // CORS — only allow explicitly whitelisted origins
  const allowedOrigin = process.env.FRONTEND_URL;
  if (isProd && !allowedOrigin) {
    console.error('[startup] FRONTEND_URL is not set — all browser requests will be CORS-rejected');
  }
  const isDev = !isProd;
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // In production: only allow the configured frontend URL.
      // In development: also allow localhost on any port.
      if (!origin) return cb(null, true); // curl/Postman/server-to-server
      if (isDev && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
      if (allowedOrigin && origin === allowedOrigin) return cb(null, true);
      // Use cb(null, false) — NOT cb(new Error()) — so Express returns a proper
      // CORS rejection instead of throwing, which NestJS would catch as a 500.
      cb(null, false);
    },
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // OpenAPI / Swagger — exposed at /api/docs and emitted to disk when
  // EXPORT_OPENAPI=1, used by CI to build the Redoc static page.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('ClaimsFlow API')
    .setDescription('REST API for CIC Insurance Group medical claims platform')
    .setVersion(process.env.npm_package_version || '1.0.0')
    .addBearerAuth()
    .addCookieAuth('access_token')
    .build();
  const swaggerDoc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${process.env.API_PREFIX || 'api'}/docs`, app, swaggerDoc);
  if (process.env.EXPORT_OPENAPI === '1') {
    const out = process.env.OPENAPI_OUTPUT || 'openapi.json';
    fs.writeFileSync(out, JSON.stringify(swaggerDoc, null, 2));
    console.log(`OpenAPI spec written to ${out}`);
    if (process.env.EXIT_AFTER_OPENAPI === '1') {
      process.exit(0);
    }
  }

  const port = process.env.PORT || 4000;
  console.log(`[bootstrap] binding HTTP listener on 0.0.0.0:${port}…`);
  // Bind to 0.0.0.0 — without an explicit host Nest defaults to listening
  // only on IPv6 / ::1 inside the container, which makes Render's health
  // probe miss the service even though it's running.
  const server = await app.listen(port, '0.0.0.0');
  // OCR on large merged PDFs can take several minutes; extend the Node.js HTTP
  // server timeout so the connection is not dropped mid-processing.
  server.setTimeout(600_000);          // 10 min
  server.keepAliveTimeout = 610_000;
  server.headersTimeout   = 620_000;
  console.log(`Application is running on port ${port}`);
}
// Surface unhandled errors loudly so a silent crash never looks like "no log
// output" again. Without these listeners the process can die mid-await and
// the only artefact is the absent next log line.
process.on('unhandledRejection', (err) => {
  console.error('[fatal] unhandledRejection:', err);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err);
  process.exit(1);
});

bootstrap().catch((err) => {
  console.error('[fatal] bootstrap failed:', err);
  process.exit(1);
});
