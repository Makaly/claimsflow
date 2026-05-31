/**
 * GDPR A3 Backfill — encrypt existing plaintext sensitive fields
 *
 * Encrypts any Claim or OcrExtraction row whose special-category fields
 * (diagnosis, treatment, rejectionReason, memberName, patientName) are still
 * stored as plaintext. Rows already starting with "enc:v1:" are skipped.
 *
 * Run once after deploying the PrismaService encryption middleware:
 *
 *   npm run backfill:encrypt
 *
 * Safe to re-run — idempotent. Processes rows in pages of 200 to avoid OOM.
 * Logs a final summary to stdout.
 */

import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { encryptField, isEncrypted } from '../common/services/field-encryption';

const PAGE = 200;

async function main() {
  const dek = process.env.DATA_ENCRYPTION_KEY;
  if (!dek || !/^[0-9a-f]{64}$/i.test(dek)) {
    console.error('ERROR: DATA_ENCRYPTION_KEY is missing or invalid. Aborting.');
    process.exit(1);
  }

  // Use a raw PrismaClient — NOT the PrismaService — so the middleware doesn't
  // double-encrypt values we're writing. We read and write raw ciphertext here.
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: ['warn', 'error'],
  });

  let claimRows = 0, claimUpdated = 0;
  let ocrRows = 0, ocrUpdated = 0;

  // ── Claims ─────────────────────────────────────────────────────────────────
  console.log('▶ Backfilling Claim.diagnosis / treatment / rejectionReason…');
  let cursor: string | undefined;

  while (true) {
    const page = await prisma.claim.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: 'asc' },
      take: PAGE,
      select: { id: true, diagnosis: true, treatment: true, rejectionReason: true },
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;
    claimRows += page.length;

    for (const row of page) {
      const update: Record<string, string | null> = {};

      if (typeof row.diagnosis === 'string' && !isEncrypted(row.diagnosis)) {
        update.diagnosis = encryptField(row.diagnosis) ?? row.diagnosis;
      }
      if (typeof row.treatment === 'string' && !isEncrypted(row.treatment)) {
        update.treatment = encryptField(row.treatment) ?? row.treatment;
      }
      if (typeof row.rejectionReason === 'string' && !isEncrypted(row.rejectionReason)) {
        update.rejectionReason = encryptField(row.rejectionReason) ?? row.rejectionReason;
      }

      if (Object.keys(update).length > 0) {
        await prisma.claim.update({ where: { id: row.id }, data: update });
        claimUpdated++;
      }
    }

    process.stdout.write(`  processed ${claimRows} claims, encrypted ${claimUpdated}\r`);
  }
  console.log(`\n  ✓ Claims: ${claimRows} scanned, ${claimUpdated} encrypted`);

  // ── OcrExtractions ─────────────────────────────────────────────────────────
  console.log('▶ Backfilling OcrExtraction.diagnosis / memberName / patientName…');
  cursor = undefined;

  while (true) {
    const page = await prisma.ocrExtraction.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: 'asc' },
      take: PAGE,
      select: { id: true, diagnosis: true, memberName: true, patientName: true },
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;
    ocrRows += page.length;

    for (const row of page) {
      const update: Record<string, string | null> = {};

      if (typeof row.diagnosis === 'string' && !isEncrypted(row.diagnosis)) {
        update.diagnosis = encryptField(row.diagnosis) ?? row.diagnosis;
      }
      if (typeof row.memberName === 'string' && !isEncrypted(row.memberName)) {
        update.memberName = encryptField(row.memberName) ?? row.memberName;
      }
      if (typeof row.patientName === 'string' && !isEncrypted(row.patientName)) {
        update.patientName = encryptField(row.patientName) ?? row.patientName;
      }

      if (Object.keys(update).length > 0) {
        await prisma.ocrExtraction.update({ where: { id: row.id }, data: update });
        ocrUpdated++;
      }
    }

    process.stdout.write(`  processed ${ocrRows} ocr extractions, encrypted ${ocrUpdated}\r`);
  }
  console.log(`\n  ✓ OcrExtractions: ${ocrRows} scanned, ${ocrUpdated} encrypted`);

  await prisma.$disconnect();

  console.log('\n══════════════════════════════════════════');
  console.log('GDPR A3 backfill complete.');
  console.log(`  Claims encrypted:         ${claimUpdated} / ${claimRows}`);
  console.log(`  OcrExtractions encrypted: ${ocrUpdated} / ${ocrRows}`);
  console.log('══════════════════════════════════════════');
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
