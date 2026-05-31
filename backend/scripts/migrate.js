'use strict';

/**
 * Boot-time migration runner.
 *
 * Prisma error P3009 occurs when a previous migration started but never
 * finished (process killed, OOM, network drop). In that state Prisma refuses
 * to apply any further migrations until the failure is explicitly resolved.
 *
 * This script:
 *   1. Queries _prisma_migrations for any started-but-never-finished rows.
 *   2. Marks each one rolled-back so Prisma will re-run it on the next step.
 *      (All ClaimsFlow migrations are idempotent — IF NOT EXISTS everywhere —
 *       so re-running a partial migration is safe.)
 *   3. Runs `prisma migrate deploy` to apply all pending migrations.
 */

const { execSync } = require('child_process');
// Prisma 7: the client is generated into src/generated/prisma and compiled to
// dist/generated/prisma; connections go through the pg driver adapter. This
// script runs in production after `npm run build`, so the compiled client
// exists. DATABASE_URL is provided by the container environment.
const { PrismaClient } = require('../dist/generated/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

// Pin the Migrate CLI to the version generating this client. The prod image is
// built with `npm install --omit=dev`, so the `prisma` CLI (a devDependency) is
// NOT present and `npx prisma …` would otherwise resolve to whatever is latest
// on npm — a newer major than this schema, which fails get-config (the outage
// that motivated the Prisma 7 move). Keep this in lockstep with the `prisma`
// and `@prisma/client` versions in package.json.
const PRISMA_CLI = 'prisma@7.8.0';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

async function main() {
  console.log('[migrate] checking for failed migrations…');

  const failed = await prisma.$queryRawUnsafe(`
    SELECT migration_name
    FROM "_prisma_migrations"
    WHERE finished_at    IS NULL
      AND rolled_back_at IS NULL
      AND started_at     IS NOT NULL
  `);

  if (failed.length === 0) {
    console.log('[migrate] no failed migrations — proceeding to deploy');
  } else {
    console.log(`[migrate] found ${failed.length} failed migration(s) — resolving…`);
    for (const { migration_name } of failed) {
      console.log(`[migrate] resolve --rolled-back ${migration_name}`);
      run(`npx ${PRISMA_CLI} migrate resolve --rolled-back "${migration_name}"`);
    }
  }

  console.log('[migrate] running prisma migrate deploy');
  run(`npx ${PRISMA_CLI} migrate deploy`);

  console.log('[migrate] all migrations applied successfully');
}

main()
  .catch((err) => {
    console.error('[migrate] fatal:', err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
