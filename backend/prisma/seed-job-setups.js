/* Seed default lookup sources + job setups. Idempotent (upsert by slug). */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function source(slug, data) {
  return prisma.lookupSource.upsert({
    where: { slug },
    update: { name: data.name, type: data.type, description: data.description, config: data.config ?? {} },
    create: { slug, name: data.name, type: data.type, description: data.description, config: data.config ?? {} },
  });
}

async function setup(slug, data, fields) {
  const existing = await prisma.jobSetup.findUnique({ where: { slug } });
  if (existing) {
    await prisma.jobSetupField.deleteMany({ where: { jobSetupId: existing.id } });
    await prisma.jobSetup.update({ where: { id: existing.id }, data });
    await prisma.jobSetupField.createMany({
      data: fields.map((f, i) => ({ ...f, jobSetupId: existing.id, sortOrder: i })),
    });
    return existing.id;
  }
  const created = await prisma.jobSetup.create({ data: { slug, ...data } });
  await prisma.jobSetupField.createMany({
    data: fields.map((f, i) => ({ ...f, jobSetupId: created.id, sortOrder: i })),
  });
  return created.id;
}

async function main() {
  const member = await source('member-policy', {
    name: 'Member / Policy', type: 'member_policy',
    description: 'Resolve member number → member name, plan, limits & balances (local DB).',
  });
  const drugs = await source('drug-formulary', {
    name: 'Drug Formulary', type: 'drug_formulary',
    description: 'Resolve drug code/name → generic, tier, covered flag, copay (local DB).',
  });
  await source('diagnosis-codes', {
    name: 'Diagnosis / Conditions', type: 'diagnosis',
    description: 'Resolve diagnosis code → condition name (local DB).',
  });
  await source('eoxegen-eligibility', {
    name: 'eOxegen Eligibility', type: 'eoxegen_eligibility',
    description: 'Live eligibility check against the eOxegen members API.',
  });

  // ── Invoice setup: member lookup auto-populates name/plan/balance ──
  await setup('invoice', {
    name: 'Invoice', documentType: 'invoice', color: '#2563eb',
    description: 'Standard medical invoice. Member lookup auto-fills patient + plan details.',
    isActive: true, learningEnabled: true, autoPopulateFromHistory: true,
  }, [
    { key: 'invoiceNumber', label: 'Invoice Number', type: 'text', source: 'extraction', extractionKey: 'invoiceNumber', required: true },
    { key: 'invoiceAmount', label: 'Invoice Amount', type: 'currency', source: 'extraction', extractionKey: 'invoiceAmount', required: true },
    { key: 'memberNumber', label: 'Member Number', type: 'text', source: 'extraction', extractionKey: 'memberNumber', isKey: true, required: true },
    { key: 'memberName', label: 'Member Name', type: 'text', source: 'lookup', lookupSourceId: member.id, lookupKeyField: 'memberNumber', lookupReturn: 'memberName', autoPopulate: true },
    { key: 'planName', label: 'Plan', type: 'text', source: 'lookup', lookupSourceId: member.id, lookupKeyField: 'memberNumber', lookupReturn: 'planName', autoPopulate: true },
    { key: 'outpatientBalance', label: 'Outpatient Balance', type: 'currency', source: 'lookup', lookupSourceId: member.id, lookupKeyField: 'memberNumber', lookupReturn: 'outpatientBalance', autoPopulate: true },
    { key: 'diagnosis', label: 'Diagnosis', type: 'text', source: 'extraction', extractionKey: 'diagnosis' },
  ]);

  // ── Pharmacy claim: drug lookup auto-populates generic/covered ──
  await setup('pharmacy-claim', {
    name: 'Pharmacy Claim', documentType: 'prescription', color: '#16a34a',
    description: 'Pharmacy dispensing claim. Drug-code lookup auto-fills formulary details.',
    isActive: true, learningEnabled: true, autoPopulateFromHistory: true,
  }, [
    { key: 'memberNumber', label: 'Member Number', type: 'text', source: 'extraction', extractionKey: 'memberNumber', isKey: true, required: true },
    { key: 'memberName', label: 'Member Name', type: 'text', source: 'lookup', lookupSourceId: member.id, lookupKeyField: 'memberNumber', lookupReturn: 'memberName', autoPopulate: true },
    { key: 'drugCode', label: 'Drug Code', type: 'text', source: 'manual', isKey: true, required: true },
    { key: 'drugName', label: 'Brand Name', type: 'text', source: 'lookup', lookupSourceId: drugs.id, lookupKeyField: 'drugCode', lookupReturn: 'brandName', autoPopulate: true },
    { key: 'genericName', label: 'Generic Name', type: 'text', source: 'lookup', lookupSourceId: drugs.id, lookupKeyField: 'drugCode', lookupReturn: 'genericName', autoPopulate: true },
    { key: 'covered', label: 'Covered', type: 'boolean', source: 'lookup', lookupSourceId: drugs.id, lookupKeyField: 'drugCode', lookupReturn: 'covered', autoPopulate: true },
    { key: 'quantity', label: 'Quantity', type: 'number', source: 'manual', required: true },
  ]);

  const setups = await prisma.jobSetup.count();
  const sources = await prisma.lookupSource.count();
  console.log(`Seeded. job_setups=${setups}, lookup_sources=${sources}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
