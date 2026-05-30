import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 dropped the `prisma` key in package.json and no longer auto-loads
// .env for CLI commands (migrate/generate/studio). `dotenv/config` above makes
// DATABASE_URL available to those commands; this file declares schema,
// migrations location, and the datasource URL that the schema's datasource
// block no longer holds (v7 moved `url` out of the schema). The application
// runtime connects through the @prisma/adapter-pg adapter — see
// src/prisma/prisma.service.ts.
//
// `prisma generate` loads this config but never connects to a database, and CI
// has no .env (DATABASE_URL is unset there), so the throwing `env('DATABASE_URL')`
// helper would abort generation — including the `prebuild` hook that runs
// `prisma generate` again inside `npm run build`. Fall back to a placeholder URL
// when the variable is unset: code generation only needs the provider, while
// Migrate/Studio and the deploy `migrate` step always run with a real
// DATABASE_URL in the environment, so the fallback never masks a real config.
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
});
