/**
 * Seed starter Document Classifier templates.
 *
 * The classifier matches an uploaded document to a template by its metadata
 * (name / documentType / provider / description) via the AI classifier, then
 * uses the template's zones to extract fields. These starter templates give the
 * classifier something to match (the list was empty — "Template cache hit (0
 * templates)") so documents get categorized; refine their zones afterwards in
 * Settings → Document Classifiers → (open template) to enable zone extraction.
 *
 * Idempotent: upserts by the unique template name. Run with:
 *   npx ts-node prisma/seed-classifier-templates.ts
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

type Starter = {
  name: string;
  documentType: string;
  providerType?: string;
  specificProvider?: string;
  description: string;
};

const STARTERS: Starter[] = [
  {
    name: 'Aga Khan University Hospital — Inpatient Invoice',
    documentType: 'inpatient_invoice',
    providerType: 'hospital',
    specificProvider: 'Aga Khan University Hospital',
    description:
      'Multi-page Aga Khan inpatient discharge bill. UH-prefixed invoice/account numbers (e.g. UH283003051), AK-prefixed member numbers, charge-category tables (Bed Charges, Theatre, Pharmacy…) and a Sponsor Coverage / Total Charges summary on the last pages.',
  },
  {
    name: 'Zion Medical Centre — Outpatient Invoice',
    documentType: 'invoice',
    providerType: 'clinic',
    specificProvider: 'Zion Medical Centre Bungoma',
    description:
      'Zion Medical Centre Bungoma outpatient detailed invoice. ZMC-prefixed invoice numbers (e.g. ZMC2024/024467), Consultation + Pharmacy line items, "Total Amount" / "Amount Receivable" footer.',
  },
  {
    name: 'AAR Insurance — Authorization Letter',
    documentType: 'authorization_letter',
    providerType: 'insurer',
    specificProvider: 'AAR Insurance Kenya',
    description:
      'AAR Insurance pre-authorization / guarantee-of-payment letter. "PRIVATE & CONFIDENTIAL", REF NO, MEMBER NO, HEALTH PLAN, ADMISSION DATE, a Ksh cover limit, signed by a Care Manager. Supporting document — attaches to the preceding invoice.',
  },
  {
    name: 'Discharge Summary',
    documentType: 'discharge_summary',
    providerType: 'hospital',
    description:
      'Hospital discharge summary. "Discharge Summary", DS: Providers / Diagnosis / Hospital Course, MR# and Account number, admission/service dates. Supporting document.',
  },
  {
    name: 'AAR Medical Claim Form',
    documentType: 'claim_form',
    providerType: 'insurer',
    specificProvider: 'AAR Insurance Kenya',
    description:
      'AAR Insurance "MEDICAL CLAIM FORM" with Section A: Patient Information and Section B: Clinical Information (complaints, findings, diagnosis, management plan). Belongs with its invoice — never a standalone claim.',
  },
];

async function main() {
  let created = 0;
  let updated = 0;
  for (const t of STARTERS) {
    const existing = await prisma.ocrTemplate.findUnique({ where: { name: t.name }, select: { id: true } });
    await prisma.ocrTemplate.upsert({
      where: { name: t.name },
      create: {
        name: t.name,
        documentType: t.documentType,
        providerType: t.providerType ?? null,
        specificProvider: t.specificProvider ?? null,
        description: t.description,
        fieldDefinitions: {},
        isActive: true,
        createdBy: 'seed-classifier-templates',
      },
      update: {
        documentType: t.documentType,
        providerType: t.providerType ?? null,
        specificProvider: t.specificProvider ?? null,
        description: t.description,
        isActive: true,
      },
    });
    existing ? updated++ : created++;
    console.log(`  ${existing ? 'updated' : 'created'}: ${t.name}`);
  }
  const total = await prisma.ocrTemplate.count();
  console.log(`\nDone. ${created} created, ${updated} updated. ${total} template(s) now active.`);
  console.log('Refine zones in Settings → Document Classifiers to enable per-field zone extraction.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
