/**
 * End-to-end simulation: creates demo accounts (if missing), generates two
 * invoices (claims), drives each through the full maker-checker workflow —
 * one approval path, one decline path — plus an admin edit to show that
 * admin changes are audited too. Prints the consolidated audit trail per
 * invoice at the end.
 *
 * Run with: npx ts-node prisma/simulate.ts  (from backend/)
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

type ActorCtx = { userId: string; ipAddress?: string; userAgent?: string };

async function audit(params: {
  actor: ActorCtx;
  action: string;
  entityId: string;
  oldValue?: any;
  newValue?: any;
  metadata?: Record<string, any>;
}) {
  const user = await prisma.user.findUnique({
    where: { id: params.actor.userId },
    select: { name: true, role: true },
  });
  await prisma.activityLog.create({
    data: {
      action: params.action,
      entity: 'claim',
      entityId: params.entityId,
      userId: params.actor.userId,
      username: user?.name ?? null,
      userRole: user?.role ?? null,
      ipAddress: params.actor.ipAddress ?? '127.0.0.1',
      userAgent: params.actor.userAgent ?? 'simulate-script',
      oldValue: params.oldValue ?? undefined,
      newValue: params.newValue ?? undefined,
      metadata: params.metadata ?? undefined,
      status: 'success',
    },
  });
}

async function ensureDemoUsers() {
  const password = await bcrypt.hash('password123', 10);

  const users = [
    { email: 'admin@cic.co.ke',       name: 'Admin User',     role: 'admin' },
    { email: 'jane@cic.co.ke',        name: 'Jane Mwangi',    role: 'claims_officer' },
    { email: 'sarah@cic.co.ke',       name: 'Sarah Wambui',   role: 'claims_officer' },
    { email: 'checker@cic.co.ke',     name: 'David Ochieng',  role: 'maker_checker' },
    { email: 'provider@demo.co.ke',   name: 'Grace Otieno',   role: 'provider_user' },
  ] as const;

  const resolved: Record<string, { id: string; name: string; role: string }> = {};
  for (const u of users) {
    const record = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, password, name: u.name, role: u.role, isActive: true },
    });
    resolved[u.role] = { id: record.id, name: record.name, role: record.role };
  }
  return resolved;
}

async function ensureDemoProvider(adminId: string) {
  return prisma.provider.upsert({
    where: { licenseNumber: 'DEMO-LIC-001' },
    update: {},
    create: {
      name: 'Demo Medical Centre',
      type: 'clinic',
      licenseNumber: 'DEMO-LIC-001',
      contactPerson: 'Demo Contact',
      email: 'demo@demomed.co.ke',
      phone: '+254 700 000 000',
      physicalAddress: 'Demo Street',
      city: 'Nairobi',
      region: 'Nairobi',
      status: 'approved',
      approvalStatus: 'approved',
      approvedBy: adminId,
      approvedAt: new Date(),
      isActive: true,
      canSubmitClaims: true,
    },
  });
}

async function createInvoice(params: {
  provider: { id: string };
  actor: ActorCtx;
  memberName: string;
  amount: number;
  diagnosis: string;
}) {
  const claimNumber = `SIM-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
  const barcode = `BAR-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
  const claim = await prisma.claim.create({
    data: {
      claimNumber,
      barcode,
      providerId: params.provider.id,
      memberNumber: 'MEM-SIM-' + Math.floor(Math.random() * 100000),
      memberName: params.memberName,
      patientName: params.memberName,
      invoiceNumber: 'INV-SIM-' + Math.floor(Math.random() * 100000),
      invoiceDate: new Date(),
      dateOfService: new Date(),
      invoiceAmount: params.amount,
      diagnosis: params.diagnosis,
      status: 'submitted',
      workflowStage: 'initial_review',
      priority: 'normal',
      isComplete: true,
      ocrStatus: 'completed',
      ocrConfidence: 0.92,
      submittedAt: new Date(),
      createdBy: params.actor.userId,
    },
  });
  await audit({
    actor: params.actor,
    action: 'claim_created',
    entityId: claim.id,
    newValue: {
      claimNumber: claim.claimNumber,
      invoiceAmount: claim.invoiceAmount,
      status: claim.status,
      workflowStage: claim.workflowStage,
    },
    metadata: { claimNumber: claim.claimNumber, source: 'simulate-script' },
  });
  return claim;
}

async function assignToMaker(claimId: string, makerId: string, actor: ActorCtx) {
  const before = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
  const after = await prisma.claim.update({
    where: { id: claimId },
    data: {
      assignedTo: makerId,
      workflowStage: 'maker_review',
      status: 'under_review',
    },
  });
  await prisma.claimStatusHistory.create({
    data: {
      claimId, fromStatus: before.status, toStatus: 'under_review',
      changedBy: actor.userId, reason: 'Assigned to maker',
    },
  });
  await audit({
    actor,
    action: 'maker_assigned',
    entityId: claimId,
    oldValue: { status: before.status, workflowStage: before.workflowStage, assignedTo: before.assignedTo },
    newValue: { status: after.status, workflowStage: after.workflowStage, assignedTo: after.assignedTo },
    metadata: { claimNumber: before.claimNumber },
  });
}

async function makerApprove(claimId: string, actor: ActorCtx, comments: string) {
  const before = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
  await prisma.claimApproval.create({
    data: {
      claimId, level: 'maker', approvalStage: 'first_approval',
      approvedBy: actor.userId, decision: 'approved', comments,
    },
  });
  const after = await prisma.claim.update({
    where: { id: claimId },
    data: { workflowStage: 'maker_checker_review', assignedTo: null, reviewedAt: new Date() },
  });
  await prisma.claimStatusHistory.create({
    data: {
      claimId, fromStatus: before.status, toStatus: 'under_review',
      changedBy: actor.userId, reason: 'Maker approved — to checker',
    },
  });
  await audit({
    actor,
    action: 'maker_approved',
    entityId: claimId,
    oldValue: { workflowStage: before.workflowStage, assignedTo: before.assignedTo },
    newValue: { workflowStage: after.workflowStage, assignedTo: after.assignedTo },
    metadata: { claimNumber: before.claimNumber, decision: 'approved', comments },
  });
}

async function checkerApprove(claimId: string, actor: ActorCtx, comments: string) {
  const before = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
  await prisma.claim.update({
    where: { id: claimId },
    data: { assignedTo: actor.userId },
  });
  await prisma.claimApproval.create({
    data: {
      claimId, level: 'maker_checker', approvalStage: 'second_approval',
      approvedBy: actor.userId, decision: 'approved', comments,
    },
  });
  const after = await prisma.claim.update({
    where: { id: claimId },
    data: {
      workflowStage: 'claims_officer_review',
      status: 'under_review',
      reviewedAt: new Date(),
      assignedTo: null,
    },
  });
  await prisma.claimStatusHistory.create({
    data: {
      claimId, fromStatus: before.status, toStatus: 'approved',
      changedBy: actor.userId, reason: 'Checker approved',
    },
  });
  await audit({
    actor,
    action: 'checker_approved',
    entityId: claimId,
    oldValue: { status: before.status, workflowStage: before.workflowStage },
    newValue: { status: after.status, workflowStage: after.workflowStage },
    metadata: { claimNumber: before.claimNumber, decision: 'approved', comments },
  });
}

async function checkerReject(claimId: string, actor: ActorCtx, reason: string) {
  const before = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
  await prisma.claim.update({
    where: { id: claimId },
    data: { assignedTo: actor.userId },
  });
  await prisma.claimApproval.create({
    data: {
      claimId, level: 'maker_checker', approvalStage: 'second_approval',
      approvedBy: actor.userId, decision: 'rejected', comments: reason,
    },
  });
  const after = await prisma.claim.update({
    where: { id: claimId },
    data: {
      status: 'rejected',
      isRejected: true,
      rejectionReason: reason,
      rejectedBy: actor.userId,
      rejectedAt: new Date(),
      workflowStage: 'completed',
      assignedTo: null,
    },
  });
  await prisma.claimStatusHistory.create({
    data: {
      claimId, fromStatus: before.status, toStatus: 'rejected',
      changedBy: actor.userId, reason,
    },
  });
  await audit({
    actor,
    action: 'checker_rejected',
    entityId: claimId,
    oldValue: { status: before.status, workflowStage: before.workflowStage },
    newValue: { status: after.status, workflowStage: after.workflowStage, rejectionReason: reason },
    metadata: { claimNumber: before.claimNumber, decision: 'rejected', reason },
  });
}

async function adminEdit(claimId: string, actor: ActorCtx, patch: Record<string, any>, note: string) {
  const before = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
  const after = await prisma.claim.update({ where: { id: claimId }, data: patch });
  const oldSubset: Record<string, any> = {};
  const newSubset: Record<string, any> = {};
  for (const key of Object.keys(patch)) {
    oldSubset[key] = (before as any)[key] ?? null;
    newSubset[key] = (after as any)[key] ?? null;
  }
  await audit({
    actor,
    action: 'claim_updated',
    entityId: claimId,
    oldValue: oldSubset,
    newValue: newSubset,
    metadata: { claimNumber: before.claimNumber, note },
  });
}

async function printAuditTrail(claimId: string) {
  const claim = await prisma.claim.findUniqueOrThrow({
    where: { id: claimId },
    select: { claimNumber: true, status: true, invoiceAmount: true },
  });

  const [statusHistory, approvals, activity] = await Promise.all([
    prisma.claimStatusHistory.findMany({
      where: { claimId }, orderBy: { createdAt: 'asc' },
    }),
    prisma.claimApproval.findMany({
      where: { claimId },
      include: { approver: { select: { name: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.activityLog.findMany({
      where: { entity: 'claim', entityId: claimId },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const actorIds = Array.from(new Set(statusHistory.map((h) => h.changedBy).filter(Boolean) as string[]));
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, role: true } })
    : [];
  const actorMap = new Map(actors.map((a) => [a.id, a]));

  const events: Array<{ at: Date; line: string }> = [];
  for (const h of statusHistory) {
    const who = h.changedBy ? actorMap.get(h.changedBy) : null;
    events.push({
      at: h.createdAt,
      line: `STATUS   ${h.fromStatus} → ${h.toStatus}   by ${who?.name ?? 'system'} (${who?.role ?? 'n/a'})${h.reason ? ` — ${h.reason}` : ''}`,
    });
  }
  for (const a of approvals) {
    events.push({
      at: a.createdAt,
      line: `DECISION ${a.level} ${a.decision.toUpperCase()}   by ${a.approver?.name ?? '?'} (${a.approver?.role ?? '?'})${a.comments ? ` — ${a.comments}` : ''}`,
    });
  }
  for (const e of activity) {
    const meta = e.newValue ? JSON.stringify(e.newValue) : '';
    events.push({
      at: e.createdAt,
      line: `ACTIVITY ${e.action}   by ${e.username ?? 'system'} (${e.userRole ?? 'n/a'}) ${meta ? `→ ${meta}` : ''}`,
    });
  }
  events.sort((a, b) => a.at.getTime() - b.at.getTime());

  console.log('');
  console.log('═'.repeat(88));
  console.log(`📄 Invoice ${claim.claimNumber}  |  status=${claim.status}  |  amount=KES ${claim.invoiceAmount}`);
  console.log('═'.repeat(88));
  for (const ev of events) {
    console.log(`  ${ev.at.toISOString()}  ${ev.line}`);
  }
}

async function main() {
  console.log('🌱 Simulation — demo accounts, end-to-end approval + decline, with audit trail\n');

  const users = await ensureDemoUsers();
  console.log('✅ Demo users ready (password: password123):');
  for (const [role, u] of Object.entries(users)) console.log(`   • ${role.padEnd(16)} ${u.name}`);

  const provider = await ensureDemoProvider(users.admin.id);
  console.log(`✅ Demo provider ready: ${provider.name}\n`);

  const adminActor:    ActorCtx = { userId: users.admin.id,           ipAddress: '10.0.0.1', userAgent: 'simulate/admin' };
  const providerActor: ActorCtx = { userId: users.provider_user.id,   ipAddress: '10.0.0.2', userAgent: 'simulate/provider' };
  const makerActor:    ActorCtx = { userId: users.claims_officer.id,  ipAddress: '10.0.0.3', userAgent: 'simulate/maker' };
  const checkerActor:  ActorCtx = { userId: users.checker.id,         ipAddress: '10.0.0.4', userAgent: 'simulate/checker' };

  // ── Flow A: provider submits → maker approves → admin edits → checker approves
  console.log('▶️  Flow A: approval path');
  const approvedClaim = await createInvoice({
    provider, actor: providerActor,
    memberName: 'Grace Njeri', amount: 18500, diagnosis: 'Outpatient consultation',
  });
  await assignToMaker(approvedClaim.id, makerActor.userId, makerActor);
  await makerApprove(approvedClaim.id, makerActor, 'Documents verified');
  await adminEdit(approvedClaim.id, adminActor, { priority: 'high', notes: 'Escalated by admin' }, 'Admin escalation before final approval');
  await checkerApprove(approvedClaim.id, checkerActor, 'Final approval granted');

  // ── Flow B: provider submits → maker approves → checker rejects
  console.log('▶️  Flow B: decline path');
  const rejectedClaim = await createInvoice({
    provider, actor: providerActor,
    memberName: 'Peter Omondi', amount: 47200, diagnosis: 'Inpatient admission',
  });
  await assignToMaker(rejectedClaim.id, makerActor.userId, makerActor);
  await makerApprove(rejectedClaim.id, makerActor, 'Passes initial checks');
  await checkerReject(rejectedClaim.id, checkerActor, 'Exceeds member policy limit');

  await printAuditTrail(approvedClaim.id);
  await printAuditTrail(rejectedClaim.id);

  console.log('\n✅ Simulation complete.');
  console.log('   Inspect via API:  GET /api/claims/<id>/audit-trail');
  console.log('   Inspect in UI:    Activity Logs page (filter by entityId)\n');
}

main()
  .catch((err) => {
    console.error('❌ Simulation failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
