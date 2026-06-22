/**
 * Seed a real licence onto the first tenant so the Usage & License page shows
 * live data. Applies a PRO licence (365-day term) + a metered-usage sample.
 *
 *   npx ts-node --transpile-only -r tsconfig-paths/register src/scripts/seed-license.ts
 *   # optional: --tenant <id> --type PRO|CORE|ENTERPRISE|TRIAL --months 12
 */
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes } from 'crypto';

const PLAN_FEATURES: Record<string, string[]> = {
  core: ['claims_intake', 'ocr_extraction'],
  pro: ['claims_intake', 'ocr_extraction', 'fraud_scoring', 'billing_audit', 'appeals_cases', 'provider_portal', 'custom_job_setups'],
  enterprise: ['claims_intake', 'ocr_extraction', 'fraud_scoring', 'billing_audit', 'appeals_cases', 'provider_portal', 'custom_job_setups', 'multi_branch', 'white_label', 'sso_enforced', 'api_access', 'audit_logs', 'on_prem_deployment'],
};
const DEFAULTS: Record<string, { plan: string; seats: number; claims: number; extractions: number; days: number }> = {
  TRIAL: { plan: 'pro', seats: 10, claims: 1000, extractions: 2000, days: 14 },
  CORE: { plan: 'core', seats: 10, claims: 5000, extractions: 10000, days: 365 },
  PRO: { plan: 'pro', seats: 50, claims: 50000, extractions: 120000, days: 365 },
  ENTERPRISE: { plan: 'enterprise', seats: 999999, claims: 999999, extractions: 999999, days: 365 },
};

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function genKey(type: string) {
  const block = () => randomBytes(2).toString('hex').toUpperCase();
  const body = `CIC-${type}-${block()}-${block()}-${block()}-${block()}`;
  const chk = createHash('sha256').update(body).digest('hex').slice(0, 4).toUpperCase();
  return `${body}-${chk}`;
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const type = (arg('type', 'PRO') || 'PRO').toUpperCase();
  const def = DEFAULTS[type] ?? DEFAULTS.PRO;
  const months = Number(arg('months', String(Math.round(def.days / 30))));

  let tenantId = arg('tenant');
  if (!tenantId) {
    const t = await prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!t) throw new Error('No tenant found — create a tenant first.');
    tenantId = t.id;
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

  const now = new Date();
  const expiry = new Date(now.getTime() + months * 30 * 86_400_000);
  const key = genKey(type);
  const features = PLAN_FEATURES[def.plan];

  await prisma.$transaction([
    prisma.tenant.update({
      where: { id: tenantId },
      data: {
        plan: def.plan,
        licenseKey: key,
        licenseType: type,
        licenseStartDate: now,
        licenseExpiryDate: expiry,
        licenseStatus: 'ACTIVE',
        licensePausedAt: null,
        maxSeats: def.seats,
        maxClaimsPerMonth: def.claims,
        maxExtractionsPerMonth: def.extractions,
        enabledFeaturesJsonb: features,
      },
    }),
    prisma.license.create({
      data: {
        tenantId,
        plan: def.plan,
        token: '',
        featuresJsonb: features,
        limitsJsonb: { claims: def.claims, extractions: def.extractions, seats: def.seats },
        enforcement: 'report',
        issuedAt: now,
        expiresAt: expiry,
        issuedTo: tenant.name,
        status: 'active',
        lastVerifiedAt: now,
      },
    }),
  ]);

  // Sample metered usage for the current period so the bars render.
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  for (const [metric, used, limit] of [['claims', 1240, def.claims], ['extractions', 3110, def.extractions], ['seats', 7, def.seats]] as [string, number, number][]) {
    await prisma.usageCounter.upsert({
      where: { tenantId_metric_period: { tenantId, metric, period } },
      create: { tenantId, metric, period, used, limit },
      update: { used, limit },
    });
  }

  console.log(`✅ Seeded ${type} (${def.plan}) licence on tenant "${tenant.name}" (${tenantId})`);
  console.log(`   Key: ${key}`);
  console.log(`   Expires: ${expiry.toISOString().slice(0, 10)} · seats=${def.seats} claims/mo=${def.claims} extractions/mo=${def.extractions}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
