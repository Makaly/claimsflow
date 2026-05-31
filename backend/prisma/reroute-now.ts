/**
 * One-shot: take every orphaned claim (initial_review + unassigned) and route
 * it to the least-loaded active claims_officer. Prints before/after counts.
 * Run with: npx ts-node prisma/reroute-now.ts
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const orphans = await prisma.claim.findMany({
    where: {
      assignedTo: null,
      workflowStage: 'initial_review',
      status: { in: ['submitted', 'resubmitted'] },
    },
    select: { id: true, claimNumber: true, status: true, workflowStage: true, memberName: true },
  });

  console.log(`🔍 Found ${orphans.length} orphan claim(s) stuck at initial_review.`);
  if (orphans.length === 0) return;

  const officers = await prisma.user.findMany({
    where: { role: 'claims_officer', isActive: true },
    select: {
      id: true, name: true,
      _count: {
        select: {
          claimsAssigned: { where: { status: { in: ['submitted', 'under_review', 'resubmitted'] } } },
        },
      },
    },
  });

  if (officers.length === 0) {
    console.log('⚠ No active claims_officer users — cannot route. Seed one first.');
    return;
  }

  officers.sort((a, b) => a._count.claimsAssigned - b._count.claimsAssigned);
  console.log(`👥 ${officers.length} claims_officer(s) available:`);
  for (const o of officers) console.log(`   • ${o.name.padEnd(24)} open=${o._count.claimsAssigned}`);

  let cursor = 0;
  for (const claim of orphans) {
    const maker = officers[cursor % officers.length];
    cursor += 1;

    await prisma.claim.update({
      where: { id: claim.id },
      data: {
        assignedTo: maker.id,
        workflowStage: 'maker_review',
        status: 'under_review',
      },
    });

    await prisma.claimStatusHistory.create({
      data: {
        claimId: claim.id,
        fromStatus: claim.status,
        toStatus: 'under_review',
        changedBy: null,
        reason: `Reroute sweep — auto-assigned to ${maker.name}`,
      },
    });

    await prisma.activityLog.create({
      data: {
        action: 'maker_auto_assigned',
        entity: 'claim',
        entityId: claim.id,
        username: 'system',
        userRole: 'system',
        oldValue: { status: claim.status, workflowStage: claim.workflowStage, assignedTo: null },
        newValue: { status: 'under_review', workflowStage: 'maker_review', assignedTo: maker.id },
        metadata: { claimNumber: claim.claimNumber, makerName: maker.name, reason: 'reroute sweep (script)' },
        status: 'success',
      },
    });

    console.log(`✅ ${claim.claimNumber} (${claim.memberName}) → ${maker.name}`);
  }

  console.log(`\n🎉 Routed ${orphans.length} claim(s) to the Maker Queue.`);
}

main()
  .catch((err) => {
    console.error('❌ Reroute failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
