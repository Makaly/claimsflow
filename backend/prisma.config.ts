import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 dropped the `prisma` key in package.json and no longer auto-loads
// .env for CLI commands (migrate/generate/studio). `dotenv/config` above makes
// DATABASE_URL available to those commands; this file declares schema,
// migrations location, and the datasource URL that the schema's datasource
// block no longer holds (v7 moved `url` out of the schema). The application
// runtime connects through the @prisma/adapter-pg adapter — see
// src/prisma/prisma.service.ts.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
