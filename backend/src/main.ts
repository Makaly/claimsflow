import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

// Allow BigInt values in JSON responses (Prisma returns BigInt for size fields)
;(BigInt.prototype as any).toJSON = function () { return Number(this) }

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Increase JSON body limit so profile updates with avatarUrl base64 don't 413
  app.use(require('express').json({ limit: '10mb' }))
  app.use(require('express').urlencoded({ limit: '10mb', extended: true }))

  // Global prefix
  app.setGlobalPrefix(process.env.API_PREFIX || 'api');

  // CORS
  const allowedOrigin = process.env.FRONTEND_URL; // e.g. https://claimsflow-frontend.onrender.com
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // Allow no-origin requests (curl/Postman), localhost (dev), and the
      // configured production frontend URL.
      if (
        !origin ||
        /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
        (allowedOrigin && origin === allowedOrigin)
      ) {
        return cb(null, true);
      }
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
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
