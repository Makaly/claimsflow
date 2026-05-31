import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  console.log('🌱 Seeding database...');

  // ── Users ──────────────────────────────────────────────────────────────────
  const password = await bcrypt.hash('password123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@cic.co.ke' },
    update: {},
    create: {
      email: 'admin@cic.co.ke',
      password,
      name: 'Admin User',
      role: 'admin',
      isActive: true,
    },
  });

  const officer = await prisma.user.upsert({
    where: { email: 'jane@cic.co.ke' },
    update: {},
    create: {
      email: 'jane@cic.co.ke',
      password,
      name: 'Jane Mwangi',
      role: 'claims_officer',
      isActive: true,
    },
  });

  // Sarah was the seeded supervisor — under the new role layout she becomes
  // a senior claims officer (final invoice approver).
  const seniorClaimsOfficer = await prisma.user.upsert({
    where: { email: 'sarah@cic.co.ke' },
    update: { role: 'claims_officer' },
    create: {
      email: 'sarah@cic.co.ke',
      password,
      name: 'Sarah Wambui',
      role: 'claims_officer',
      isActive: true,
    },
  });

  // David was the seeded checker — becomes a maker_checker (capture verifier + QA).
  const makerChecker = await prisma.user.upsert({
    where: { email: 'checker@cic.co.ke' },
    update: { role: 'maker_checker' },
    create: {
      email: 'checker@cic.co.ke',
      password,
      name: 'David Ochieng',
      role: 'maker_checker',
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { email: 'fraud@cic.co.ke' },
    update: {},
    create: {
      email: 'fraud@cic.co.ke',
      password,
      name: 'Peter Kariuki',
      role: 'fraud_officer',
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { email: 'finance@cic.co.ke' },
    update: {},
    create: {
      email: 'finance@cic.co.ke',
      password,
      name: 'Grace Njeri',
      role: 'finance',
      isActive: true,
    },
  });

  console.log('✅ Users created');

  // ── Providers ──────────────────────────────────────────────────────────────
  const nairobi = await prisma.provider.upsert({
    where: { licenseNumber: 'LIC-001' },
    update: {},
    create: {
      name: 'Nairobi Hospital',
      type: 'hospital',
      licenseNumber: 'LIC-001',
      contactPerson: 'Dr. James Maina',
      email: 'admin@nairobihospital.co.ke',
      phone: '+254 20 284 5000',
      physicalAddress: 'Argwings Kodhek Road, Nairobi',
      city: 'Nairobi',
      region: 'Nairobi',
      status: 'approved',
      approvalStatus: 'approved',
      approvedBy: admin.id,
      approvedAt: new Date('2025-01-15'),
      isActive: true,
      canSubmitClaims: true,
      createdAt: new Date('2025-01-15'),
    },
  });

  const agakhan = await prisma.provider.upsert({
    where: { licenseNumber: 'LIC-002' },
    update: {},
    create: {
      name: 'Aga Khan University Hospital',
      type: 'hospital',
      licenseNumber: 'LIC-002',
      contactPerson: 'Dr. Fatima Omar',
      email: 'admin@agakhan.org',
      phone: '+254 20 366 2000',
      physicalAddress: '3rd Parklands Avenue, Nairobi',
      city: 'Nairobi',
      region: 'Nairobi',
      status: 'approved',
      approvalStatus: 'approved',
      approvedBy: admin.id,
      approvedAt: new Date('2025-01-20'),
      isActive: true,
      canSubmitClaims: true,
      createdAt: new Date('2025-01-20'),
    },
  });

  const mombasa = await prisma.provider.upsert({
    where: { licenseNumber: 'LIC-003' },
    update: {},
    create: {
      name: 'Mombasa Medical Centre',
      type: 'clinic',
      licenseNumber: 'LIC-003',
      contactPerson: 'Dr. Hassan Ali',
      email: 'info@mombasamedical.co.ke',
      phone: '+254 41 222 1234',
      physicalAddress: 'Nkrumah Road, Mombasa',
      city: 'Mombasa',
      region: 'Coast',
      status: 'pending',
      approvalStatus: 'pending_approval',
      isActive: false,
      canSubmitClaims: false,
      createdAt: new Date('2026-03-10'),
    },
  });

  const eldoret = await prisma.provider.upsert({
    where: { licenseNumber: 'LIC-004' },
    update: {},
    create: {
      name: 'Eldoret Pharmacy Ltd',
      type: 'pharmacy',
      licenseNumber: 'LIC-004',
      contactPerson: 'Mary Chebet',
      email: 'info@eldoretpharmacy.co.ke',
      phone: '+254 53 206 3000',
      physicalAddress: 'Uganda Road, Eldoret',
      city: 'Eldoret',
      region: 'Rift Valley',
      status: 'approved',
      approvalStatus: 'approved',
      approvedBy: admin.id,
      approvedAt: new Date('2025-06-01'),
      isActive: true,
      canSubmitClaims: true,
      createdAt: new Date('2025-06-01'),
    },
  });

  const pathcare = await prisma.provider.upsert({
    where: { licenseNumber: 'LIC-005' },
    update: {},
    create: {
      name: 'Pathcare Kenya',
      type: 'lab',
      licenseNumber: 'LIC-005',
      contactPerson: 'Dr. Sarah Wambui',
      email: 'info@pathcare.co.ke',
      phone: '+254 20 271 5000',
      physicalAddress: 'Upper Hill, Nairobi',
      city: 'Nairobi',
      region: 'Nairobi',
      status: 'suspended',
      approvalStatus: 'approved',
      isActive: false,
      canSubmitClaims: false,
      createdAt: new Date('2025-03-15'),
    },
  });

  const kisumu = await prisma.provider.upsert({
    where: { licenseNumber: 'LIC-006' },
    update: {},
    create: {
      name: 'Kisumu Specialists Clinic',
      type: 'clinic',
      licenseNumber: 'LIC-006',
      contactPerson: 'Dr. Otieno Odhiambo',
      email: 'info@kisumuspecialists.co.ke',
      phone: '+254 57 202 5678',
      physicalAddress: 'Oginga Odinga Street, Kisumu',
      city: 'Kisumu',
      region: 'Nyanza',
      status: 'approved',
      approvalStatus: 'approved',
      approvedBy: admin.id,
      approvedAt: new Date('2025-08-20'),
      isActive: true,
      canSubmitClaims: true,
      createdAt: new Date('2025-08-20'),
    },
  });

  console.log('✅ Providers created');

  // ── Branches ───────────────────────────────────────────────────────────────
  await prisma.branch.upsert({
    where: { code: 'NBI-HQ' },
    update: {},
    create: {
      code: 'NBI-HQ',
      name: 'Nairobi Headquarters',
      providerId: nairobi.id,
      region: 'Nairobi',
      county: 'Nairobi',
      address: 'Argwings Kodhek Road',
      phone: '+254 20 284 5000',
      email: 'hq@nairobihospital.co.ke',
      contactPerson: 'Dr. James Maina',
      isActive: true,
      isApproved: true,
    },
  });

  await prisma.branch.upsert({
    where: { code: 'NBI-WEST' },
    update: {},
    create: {
      code: 'NBI-WEST',
      name: 'Nairobi West Branch',
      providerId: nairobi.id,
      region: 'Nairobi',
      county: 'Nairobi',
      address: 'Nairobi West Hospital Road',
      phone: '+254 20 603 5000',
      email: 'west@nairobihospital.co.ke',
      contactPerson: 'Dr. Alice Kamau',
      isActive: true,
      isApproved: true,
    },
  });

  await prisma.branch.upsert({
    where: { code: 'AKH-MAIN' },
    update: {},
    create: {
      code: 'AKH-MAIN',
      name: 'Aga Khan Main Campus',
      providerId: agakhan.id,
      region: 'Nairobi',
      county: 'Nairobi',
      address: '3rd Parklands Avenue',
      phone: '+254 20 366 2000',
      email: 'main@agakhan.org',
      contactPerson: 'Dr. Fatima Omar',
      isActive: true,
      isApproved: true,
    },
  });

  await prisma.branch.upsert({
    where: { code: 'ELD-MAIN' },
    update: {},
    create: {
      code: 'ELD-MAIN',
      name: 'Eldoret Main Branch',
      providerId: eldoret.id,
      region: 'Rift Valley',
      county: 'Uasin Gishu',
      address: 'Uganda Road, Eldoret',
      phone: '+254 53 206 3000',
      email: 'main@eldoretpharmacy.co.ke',
      contactPerson: 'Mary Chebet',
      isActive: true,
      isApproved: true,
    },
  });

  await prisma.branch.upsert({
    where: { code: 'KSM-MAIN' },
    update: {},
    create: {
      code: 'KSM-MAIN',
      name: 'Kisumu Main Branch',
      providerId: kisumu.id,
      region: 'Nyanza',
      county: 'Kisumu',
      address: 'Oginga Odinga Street',
      phone: '+254 57 202 5678',
      email: 'main@kisumuspecialists.co.ke',
      contactPerson: 'Dr. Otieno Odhiambo',
      isActive: true,
      isApproved: true,
    },
  });

  console.log('✅ Branches created');

  // ── Provider-mapped Users ──────────────────────────────────────────────────
  // Fetch branches so we can assign branchId to provider_users
  const branchNbiHq   = await prisma.branch.findUnique({ where: { code: 'NBI-HQ' } });
  const branchNbiWest = await prisma.branch.findUnique({ where: { code: 'NBI-WEST' } });
  const branchAkh     = await prisma.branch.findUnique({ where: { code: 'AKH-MAIN' } });
  const branchEld     = await prisma.branch.findUnique({ where: { code: 'ELD-MAIN' } });
  const branchKsm     = await prisma.branch.findUnique({ where: { code: 'KSM-MAIN' } });

  // Nairobi Hospital – admin
  const nbiAdmin = await prisma.user.upsert({
    where: { email: 'admin@nairobihospital.co.ke' },
    update: {},
    create: {
      email: 'admin@nairobihospital.co.ke',
      password,
      name: 'Dr. James Maina',
      role: 'provider_admin',
      isActive: true,
      providerId: nairobi.id,
    },
  });

  // Nairobi Hospital HQ – invoice uploader
  const nbiHqUploader = await prisma.user.upsert({
    where: { email: 'billing.hq@nairobihospital.co.ke' },
    update: {},
    create: {
      email: 'billing.hq@nairobihospital.co.ke',
      password,
      name: 'Alice Kimani',
      role: 'provider_user',
      isActive: true,
      providerId: nairobi.id,
      branchId: branchNbiHq?.id ?? null,
    },
  });

  // Nairobi Hospital West – branch manager
  const nbiWestManager = await prisma.user.upsert({
    where: { email: 'manager.west@nairobihospital.co.ke' },
    update: {},
    create: {
      email: 'manager.west@nairobihospital.co.ke',
      password,
      name: 'Peter Njoroge',
      role: 'provider_user',
      isActive: true,
      providerId: nairobi.id,
      branchId: branchNbiWest?.id ?? null,
    },
  });

  // Nairobi Hospital West – invoice uploader
  const nbiWestUploader = await prisma.user.upsert({
    where: { email: 'billing.west@nairobihospital.co.ke' },
    update: {},
    create: {
      email: 'billing.west@nairobihospital.co.ke',
      password,
      name: 'Joyce Wanjiku',
      role: 'provider_user',
      isActive: true,
      providerId: nairobi.id,
      branchId: branchNbiWest?.id ?? null,
    },
  });

  // Aga Khan – admin
  const akhAdmin = await prisma.user.upsert({
    where: { email: 'admin@agakhan.org' },
    update: {},
    create: {
      email: 'admin@agakhan.org',
      password,
      name: 'Dr. Fatima Omar',
      role: 'provider_admin',
      isActive: true,
      providerId: agakhan.id,
    },
  });

  // Aga Khan Main – invoice uploader
  const akhUploader = await prisma.user.upsert({
    where: { email: 'billing@agakhan.org' },
    update: {},
    create: {
      email: 'billing@agakhan.org',
      password,
      name: 'Hassan Abdi',
      role: 'provider_user',
      isActive: true,
      providerId: agakhan.id,
      branchId: branchAkh?.id ?? null,
    },
  });

  // Eldoret Pharmacy – admin (no branches, so admin is the uploader)
  const eldAdmin = await prisma.user.upsert({
    where: { email: 'info@eldoretpharmacy.co.ke' },
    update: {},
    create: {
      email: 'info@eldoretpharmacy.co.ke',
      password,
      name: 'Mary Chebet',
      role: 'provider_admin',
      isActive: true,
      providerId: eldoret.id,
    },
  });

  // Eldoret Main – uploader
  const eldUploader = await prisma.user.upsert({
    where: { email: 'billing@eldoretpharmacy.co.ke' },
    update: {},
    create: {
      email: 'billing@eldoretpharmacy.co.ke',
      password,
      name: 'Samuel Rotich',
      role: 'provider_user',
      isActive: true,
      providerId: eldoret.id,
      branchId: branchEld?.id ?? null,
    },
  });

  // Kisumu Specialists – admin
  const ksmAdmin = await prisma.user.upsert({
    where: { email: 'info@kisumuspecialists.co.ke' },
    update: {},
    create: {
      email: 'info@kisumuspecialists.co.ke',
      password,
      name: 'Dr. Otieno Odhiambo',
      role: 'provider_admin',
      isActive: true,
      providerId: kisumu.id,
    },
  });

  // Kisumu Main – uploader
  const ksmUploader = await prisma.user.upsert({
    where: { email: 'billing@kisumuspecialists.co.ke' },
    update: {},
    create: {
      email: 'billing@kisumuspecialists.co.ke',
      password,
      name: 'Auma Otieno',
      role: 'provider_user',
      isActive: true,
      providerId: kisumu.id,
      branchId: branchKsm?.id ?? null,
    },
  });

  console.log('✅ Provider-mapped users created');

  // ── Wire up branch staff assignments ──────────────────────────────────────
  if (branchNbiHq) {
    await prisma.branch.update({
      where: { id: branchNbiHq.id },
      data: { invoiceUploaderId: nbiHqUploader.id, branchManagerId: nbiAdmin.id },
    });
  }
  if (branchNbiWest) {
    await prisma.branch.update({
      where: { id: branchNbiWest.id },
      data: { invoiceUploaderId: nbiWestUploader.id, branchManagerId: nbiWestManager.id },
    });
  }
  if (branchAkh) {
    await prisma.branch.update({
      where: { id: branchAkh.id },
      data: { invoiceUploaderId: akhUploader.id, branchManagerId: akhAdmin.id },
    });
  }
  if (branchEld) {
    await prisma.branch.update({
      where: { id: branchEld.id },
      data: { invoiceUploaderId: eldUploader.id, branchManagerId: eldAdmin.id },
    });
  }
  if (branchKsm) {
    await prisma.branch.update({
      where: { id: branchKsm.id },
      data: { invoiceUploaderId: ksmUploader.id, branchManagerId: ksmAdmin.id },
    });
  }

  // Designate invoice uploader on providers that have no-branch structure
  await prisma.provider.update({
    where: { id: eldoret.id },
    data: { invoiceUploaderId: eldAdmin.id },
  });

  console.log('✅ Branch staff assignments wired up');

  // ── Sample Claims ──────────────────────────────────────────────────────────
  const claimsData = [
    {
      claimNumber: 'CLM-2025-0001',
      barcode: 'BAR-2025-0001',
      providerId: nairobi.id,
      memberNumber: 'MEM-001234',
      memberName: 'John Kamau',
      patientName: 'John Kamau',
      invoiceNumber: 'INV-NBI-001',
      invoiceDate: new Date('2025-03-10'),
      invoiceAmount: 15500,
      dateOfService: new Date('2025-03-10'),
      diagnosis: 'Acute Malaria',
      status: 'approved',
      workflowStage: 'completed',
      priority: 'normal',
      isComplete: true,
      ocrStatus: 'completed',
      ocrConfidence: 0.95,
      submittedAt: new Date('2025-03-11'),
      createdBy: officer.id,
    },
    {
      claimNumber: 'CLM-2025-0002',
      barcode: 'BAR-2025-0002',
      providerId: agakhan.id,
      memberNumber: 'MEM-005678',
      memberName: 'Amina Hassan',
      patientName: 'Amina Hassan',
      invoiceNumber: 'INV-AKH-001',
      invoiceDate: new Date('2025-03-12'),
      invoiceAmount: 42000,
      dateOfService: new Date('2025-03-12'),
      diagnosis: 'Appendicitis - surgical removal',
      status: 'under_review',
      workflowStage: 'maker_review',
      priority: 'high',
      isComplete: true,
      ocrStatus: 'completed',
      ocrConfidence: 0.88,
      submittedAt: new Date('2025-03-13'),
      assignedTo: officer.id,
      createdBy: officer.id,
    },
    {
      claimNumber: 'CLM-2025-0003',
      barcode: 'BAR-2025-0003',
      providerId: eldoret.id,
      memberNumber: 'MEM-009012',
      memberName: 'Peter Kipchoge',
      patientName: 'Peter Kipchoge',
      invoiceNumber: 'INV-ELD-001',
      invoiceDate: new Date('2025-03-15'),
      invoiceAmount: 3200,
      dateOfService: new Date('2025-03-15'),
      diagnosis: 'Diabetes medication refill',
      status: 'submitted',
      workflowStage: 'initial_review',
      priority: 'normal',
      isComplete: true,
      ocrStatus: 'completed',
      ocrConfidence: 0.92,
      submittedAt: new Date('2025-03-16'),
      createdBy: officer.id,
    },
    {
      claimNumber: 'CLM-2025-0004',
      barcode: 'BAR-2025-0004',
      providerId: kisumu.id,
      memberNumber: 'MEM-003456',
      memberName: 'Grace Achieng',
      patientName: 'Grace Achieng',
      invoiceNumber: 'INV-KSM-001',
      invoiceDate: new Date('2025-03-18'),
      invoiceAmount: 8750,
      dateOfService: new Date('2025-03-18'),
      diagnosis: 'Prenatal checkup & blood tests',
      status: 'incomplete',
      workflowStage: 'initial_review',
      priority: 'urgent',
      isComplete: false,
      missingDocuments: ['lab_result', 'prescription'],
      ocrStatus: 'completed',
      ocrConfidence: 0.76,
      submittedAt: new Date('2025-03-19'),
      createdBy: officer.id,
    },
    {
      claimNumber: 'CLM-2025-0005',
      barcode: 'BAR-2025-0005',
      providerId: nairobi.id,
      memberNumber: 'MEM-007890',
      memberName: 'Samuel Mwenda',
      patientName: 'Samuel Mwenda',
      invoiceNumber: 'INV-NBI-002',
      invoiceDate: new Date('2025-03-20'),
      invoiceAmount: 125000,
      dateOfService: new Date('2025-03-19'),
      diagnosis: 'Cardiac catheterization',
      status: 'under_review',
      workflowStage: 'maker_checker_review',
      priority: 'urgent',
      isComplete: true,
      ocrStatus: 'completed',
      ocrConfidence: 0.91,
      submittedAt: new Date('2025-03-21'),
      assignedTo: makerChecker.id,
      createdBy: officer.id,
    },
    {
      claimNumber: 'CLM-2025-0006',
      barcode: 'BAR-2025-0006',
      providerId: agakhan.id,
      memberNumber: 'MEM-002345',
      memberName: 'Fatuma Osman',
      patientName: 'Fatuma Osman',
      invoiceNumber: 'INV-AKH-002',
      invoiceDate: new Date('2025-03-22'),
      invoiceAmount: 19800,
      dateOfService: new Date('2025-03-22'),
      diagnosis: 'Fracture - right tibia, cast applied',
      status: 'rejected',
      workflowStage: 'completed',
      priority: 'normal',
      isComplete: true,
      isRejected: true,
      rejectionReason: 'Diagnosis code mismatch with treatment plan',
      ocrStatus: 'completed',
      ocrConfidence: 0.85,
      submittedAt: new Date('2025-03-23'),
      createdBy: officer.id,
    },
  ];

  for (const claim of claimsData) {
    await prisma.claim.upsert({
      where: { claimNumber: claim.claimNumber },
      update: {},
      create: claim as any,
    });
  }

  console.log('✅ Sample claims created');

  // ── Activity Logs ──────────────────────────────────────────────────────────
  await prisma.activityLog.createMany({
    data: [
      {
        userId: admin.id,
        username: admin.name,
        userRole: 'admin',
        action: 'login',
        entity: 'user',
        entityId: admin.id,
        status: 'success',
        ipAddress: '192.168.1.1',
        method: 'POST',
        endpoint: '/api/auth/login',
      },
      {
        userId: officer.id,
        username: officer.name,
        userRole: 'claims_officer',
        action: 'create_claim',
        entity: 'claim',
        entityId: 'CLM-2025-0001',
        status: 'success',
        ipAddress: '192.168.1.10',
        method: 'POST',
        endpoint: '/api/claims',
      },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Activity logs created');

  // Mark every seeded user as email-verified so dev/demo accounts can log in
  // without going through the OTP flow. Real users created via the registration
  // form start unverified and must verify via OTP.
  await prisma.user.updateMany({
    where: { emailVerifiedAt: null },
    data: { emailVerifiedAt: new Date() },
  });
  console.log('✅ Seeded users email-verified');

  console.log('\n🎉 Seed complete!\n');

  // Demo accounts and their shared password are dev-only conveniences.
  // Printing them in production logs surfaces working credentials to anyone
  // with read-only log access (third-party log aggregators, dashboards
  // shared with contractors, etc.) — gate behind NODE_ENV.
  if (process.env.NODE_ENV !== 'production') {
    console.log('Demo credentials (password: password123):');
    console.log('  CIC Staff:');
    console.log('    Admin              → admin@cic.co.ke');
    console.log('    Claims Officer     → jane@cic.co.ke');
    console.log('    Sr Claims Officer  → sarah@cic.co.ke');
    console.log('    Maker-Checker      → checker@cic.co.ke');
    console.log('    Fraud Officer      → fraud@cic.co.ke');
    console.log('    Finance            → finance@cic.co.ke');
    console.log('  Provider Admins:');
    console.log('    Nairobi Hospital   → admin@nairobihospital.co.ke');
    console.log('    Aga Khan           → admin@agakhan.org');
    console.log('    Eldoret Pharmacy   → info@eldoretpharmacy.co.ke');
    console.log('    Kisumu Specialists → info@kisumuspecialists.co.ke');
    console.log('  Provider Users (invoice uploaders):');
    console.log('    NBI HQ uploader    → billing.hq@nairobihospital.co.ke');
    console.log('    NBI West uploader  → billing.west@nairobihospital.co.ke');
    console.log('    Aga Khan uploader  → billing@agakhan.org');
    console.log('    Eldoret uploader   → billing@eldoretpharmacy.co.ke');
    console.log('    Kisumu uploader    → billing@kisumuspecialists.co.ke');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
