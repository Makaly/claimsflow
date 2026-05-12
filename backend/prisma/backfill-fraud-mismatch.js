/**
 * Backfill: retroactively inject "Provider Mismatch" fraud signal on claims
 * where the uploader (from ActivityLog) is a provider_user/provider_admin whose
 * assigned provider differs from the provider on the invoice.
 *
 * Strategy:
 *   1. For each claim with no fraudSignals (or without the mismatch signal):
 *      a. Try claim.createdBy (FK, set on new claims after the fix)
 *      b. Fall back to ActivityLog: find the oldest 'claim_created' entry
 *         for this entityId — that userId is the uploader
 *   2. If uploader is a provider user/admin whose providerId ≠ claim.providerId → flag
 *
 * CIC staff (admin, claims_officer, supervisor, checker) are exempt.
 *
 * Run: node prisma/backfill-fraud-mismatch.js
 */
const { PrismaClient } = require('../node_modules/@prisma/client');
const p = new PrismaClient();

const MISMATCH_TITLE = 'Provider Mismatch — Possible Fraud';
const PROVIDER_ROLES = new Set(['provider_user', 'provider_admin']);

async function run() {
  const claims = await p.claim.findMany({
    select: {
      id: true,
      claimNumber: true,
      batchNumber: true,
      providerId: true,
      fraudSignals: true,
      createdBy: true,
      provider: { select: { name: true } },
      creator: { select: { id: true, role: true, providerId: true, provider: { select: { name: true } } } },
    },
  });

  // Build a userId cache to avoid redundant DB lookups
  const userCache = new Map();
  async function getUser(userId) {
    if (userCache.has(userId)) return userCache.get(userId);
    const u = await p.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, providerId: true, provider: { select: { name: true } } },
    });
    userCache.set(userId, u);
    return u;
  }

  let flagged = 0;
  let skipped = 0;

  for (const claim of claims) {
    // Already flagged?
    const existing = Array.isArray(claim.fraudSignals) ? claim.fraudSignals : [];
    if (existing.some((s) => s.title === MISMATCH_TITLE)) { skipped++; continue; }

    // Resolve uploader userId: prefer createdBy FK, fall back to ActivityLog
    let uploaderId = claim.createdBy ?? null;

    if (!uploaderId) {
      const logEntry = await p.activityLog.findFirst({
        where: { entity: 'claim', entityId: claim.id, action: 'claim_created' },
        orderBy: { createdAt: 'asc' },
        select: { userId: true },
      });
      uploaderId = logEntry?.userId ?? null;
    }

    if (!uploaderId) { skipped++; continue; }

    const uploader = await getUser(uploaderId);
    if (!uploader || !PROVIDER_ROLES.has(uploader.role)) { skipped++; continue; }
    if (!uploader.providerId) { skipped++; continue; }
    if (uploader.providerId === claim.providerId) { skipped++; continue; }

    // Resolve the invoice's provider name
    let invoiceProviderName = claim.provider?.name;
    if (!invoiceProviderName) {
      const prov = await p.provider.findUnique({ where: { id: claim.providerId }, select: { name: true } });
      invoiceProviderName = prov?.name ?? 'Unknown';
    }

    const signal = {
      level: 'critical',
      title: MISMATCH_TITLE,
      detail: `This invoice was uploaded by a user belonging to "${uploader.provider?.name ?? 'Unknown'}" but the invoice identifies the provider as "${invoiceProviderName}". Submitting claims on behalf of a different provider is a critical fraud indicator. This claim has been retroactively flagged.`,
      detectedAt: new Date().toISOString(),
    };

    await p.claim.update({
      where: { id: claim.id },
      data: { fraudSignals: [signal, ...existing] },
    });

    console.log(`FLAGGED: ${claim.claimNumber} (batch ${claim.batchNumber ?? '-'}) — uploader provider: ${uploader.provider?.name}, invoice provider: ${invoiceProviderName}`);
    flagged++;
  }

  console.log(`\nDone — ${flagged} flagged, ${skipped} skipped (already correct, CIC staff, or no uploader found).`);
  await p.$disconnect();
}

run().catch((e) => { console.error(e); process.exit(1); });
