import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

// Allow BigInt values in JSON responses (Prisma returns BigInt for size fields)
;(BigInt.prototype as any).toJSON = function () { return Number(this) }

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security headers — must be applied before CORS and body parsers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Cookie parser — required for HttpOnly JWT cookie extraction
  app.use(cookieParser());

  // Increase JSON body limit so profile updates with avatarUrl base64 don't 413
  app.use(require('express').json({ limit: '10mb' }))
  app.use(require('express').urlencoded({ limit: '10mb', extended: true }))

  // Global prefix
  app.setGlobalPrefix(process.env.API_PREFIX || 'api');

  // CORS — only allow explicitly whitelisted origins
  const allowedOrigin = process.env.FRONTEND_URL;
  const isDev = process.env.NODE_ENV !== 'production';
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // In production: only allow the configured frontend URL.
      // In development: also allow localhost on any port.
      if (!origin) return cb(null, true); // curl/Postman/server-to-server
      if (isDev && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
      if (allowedOrigin && origin === allowedOrigin) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
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

  const port = process.env.PORT || 4000;
  const server = await app.listen(port);
  // OCR on large merged PDFs can take several minutes; extend the Node.js HTTP
  // server timeout so the connection is not dropped mid-processing.
  server.setTimeout(600_000);          // 10 min
  server.keepAliveTimeout = 610_000;
  server.headersTimeout   = 620_000;
  console.log(`Application is running on port ${port}`);
}
bootstrap();
