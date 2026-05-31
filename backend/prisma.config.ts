import 'dotenv/config';

// NOTE: we intentionally do NOT `import { defineConfig } from 'prisma/config'`.
// The prod image installs runtime deps with `npm install --omit=dev`, so the
// `prisma` package (a devDependency) is absent from node_modules. Prisma's
// config loader resolves this file's imports relative to the file itself, so a
// `prisma/config` import throws `Cannot find module 'prisma/config'` at boot —
// after schema validation passes, which is why it surfaced as a bare exit 1 and
// not a P1012. `defineConfig` only stamps `loadedFromFile` (which Prisma sets
// itself when loading from a file), so a plain default-export object is
// equivalent and needs no extra dependency. `dotenv` is a prod dependency, so
// the `dotenv/config` import above is safe.

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

export default {
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
};
