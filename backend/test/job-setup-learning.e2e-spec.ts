import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { JobSetupKnowledgeService } from '../src/job-setup/job-setup-knowledge.service';

/**
 * Seeded e2e for the "system gets more accurate over time" user story
 * (Test 3 in docs/USER_STORY_learning_accuracy.md).
 *
 * What it proves: as a Job Setup observes more confirmed invoices, the value it
 * auto-fills (JobSetupKnowledgeService.topValue — highest-frequency confirmed
 * value for a field) increasingly matches the value the user would have entered.
 * We measure this as a rolling accuracy that must RISE across the stream and
 * clear a target by the end, with corrections-per-invoice falling — i.e. the
 * setup becomes self-sufficient with use.
 *
 * Mechanic under test (see job-setup-knowledge.service.ts):
 *   - record()   accumulates frequency per (jobSetupId, fieldKey, valueNorm)
 *   - topValue() returns the highest-frequency confirmed value (the auto-fill)
 * The simulation streams realistic, skewed invoices: each field has a dominant
 * "house" value plus noise. Cold start (no knowledge) yields misses; as
 * frequency accumulates, topValue locks onto the dominant value and accuracy
 * converges toward the dominant proportion.
 *
 * This is a REAL-DB test: it writes to job_setups / job_setup_knowledge through
 * the app's PrismaService. It is skipped when DATABASE_URL is unset so it never
 * silently passes in an infra-less CI lane (matches the full-stack e2e gating).
 */

// ---- deterministic PRNG (mulberry32) — no Math.random, so the run is stable
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Weighted pick from [value, weight] pairs (weights need not sum to 1).
function pick(rng: () => number, dist: ReadonlyArray<readonly [string, number]>): string {
  const total = dist.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [value, w] of dist) {
    r -= w;
    if (r <= 0) return value;
  }
  return dist[dist.length - 1][0];
}

// Mirrors normVal() in the service so prediction/ground-truth compare the same way.
const norm = (v: unknown) =>
  String(v ?? '').toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Realistic skewed invoice stream for one clinic indexing under one setup.
 * Each field has a dominant value the system should converge on.
 *   currency: always KES        -> steady accuracy contribution 1.00
 *   provider: dominant ~0.80
 *   scheme:   dominant ~0.85
 * Expected post-warmup rolling accuracy ≈ (1.00 + 0.80 + 0.85) / 3 ≈ 0.88.
 */
const FIELD_DIST: Record<string, ReadonlyArray<readonly [string, number]>> = {
  currency: [['KES', 1.0]],
  provider: [
    ['Aga Khan University Hospital', 0.8],
    ['Nairobi Hospital', 0.1],
    ['MP Shah Hospital', 0.1],
  ],
  scheme: [
    ['Corporate', 0.85],
    ['Retail', 0.1],
    ['SHA', 0.05],
  ],
};
const FIELDS = Object.keys(FIELD_DIST);

const STREAM_SIZE = 80;
const WINDOW = 12; // sliding window for early-vs-late comparison
const TARGET_ACCURACY = 0.75; // final-window auto-fill accuracy must clear this

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('Job Setup learning — accuracy improves over time (e2e)', () => {
  let prisma: PrismaService;
  let knowledge: JobSetupKnowledgeService;
  let setupId: string;

  beforeAll(async () => {
    // Instantiate PrismaService directly and connect — bypassing onModuleInit
    // (which runs `prisma migrate deploy`) keeps the test fast and side-effect
    // free; the schema is assumed already migrated for the target DB.
    prisma = new PrismaService();
    await prisma.$connect();
    knowledge = new JobSetupKnowledgeService(prisma);

    const setup = await prisma.jobSetup.create({
      data: {
        name: 'E2E Learning Probe',
        slug: `e2e-learning-${Date.now()}`,
        learningEnabled: true,
        autoPopulateFromHistory: true,
      },
    });
    setupId = setup.id;
  });

  afterAll(async () => {
    if (setupId) {
      // Cascade on JobSetupKnowledge.jobSetupId removes learned rows with the setup.
      await prisma.jobSetup.delete({ where: { id: setupId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it('starts cold, then converges so auto-fill accuracy rises and corrections fall', async () => {
    const rng = mulberry32(0xc1a1a5); // fixed seed => deterministic stream
    const perInvoiceAccuracy: number[] = [];

    for (let i = 0; i < STREAM_SIZE; i++) {
      // Draw this invoice's ground-truth values from the skewed distribution.
      const truth: Record<string, string> = {};
      for (const f of FIELDS) truth[f] = pick(rng, FIELD_DIST[f]);

      // PREDICT before confirming: what would the system auto-fill right now?
      let hits = 0;
      for (const f of FIELDS) {
        // eslint-disable-next-line no-await-in-loop
        const predicted = await knowledge.topValue(setupId, f);
        if (predicted !== null && norm(predicted) === norm(truth[f])) hits++;
      }
      perInvoiceAccuracy.push(hits / FIELDS.length);

      // CONFIRM: feed the confirmed values back so the setup learns from this invoice.
      // eslint-disable-next-line no-await-in-loop
      const res = await knowledge.record(setupId, truth);
      expect(res.recorded).toBe(FIELDS.length);
    }

    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const early = avg(perInvoiceAccuracy.slice(0, WINDOW));
    const late = avg(perInvoiceAccuracy.slice(-WINDOW));

    // eslint-disable-next-line no-console
    console.log(
      `[learning] early-window acc=${early.toFixed(3)} ` +
        `late-window acc=${late.toFixed(3)} ` +
        `early-corrections/inv=${((1 - early) * FIELDS.length).toFixed(2)} ` +
        `late-corrections/inv=${((1 - late) * FIELDS.length).toFixed(2)}`,
    );

    // Cold start: the very first invoice has no knowledge, so nothing auto-fills.
    expect(perInvoiceAccuracy[0]).toBe(0);

    // Core claim: it gets MORE accurate with use, and clears the target.
    expect(late).toBeGreaterThan(early);
    expect(late).toBeGreaterThanOrEqual(TARGET_ACCURACY);

    // Self-sufficiency: corrections-per-invoice trend DOWN (miss rate falls).
    expect(1 - late).toBeLessThan(1 - early);

    // Sanity: the setup actually accumulated knowledge for every field.
    const stats = await knowledge.stats(setupId);
    expect(stats.length).toBe(FIELDS.length);
    for (const s of stats) {
      expect(s.totalObservations).toBe(STREAM_SIZE);
    }
  }, 60_000);

  it('locks onto the dominant value for each field after the stream', async () => {
    // After the run above, auto-fill should equal each field's house value.
    expect(await knowledge.topValue(setupId, 'currency')).toBe('KES');
    expect(await knowledge.topValue(setupId, 'provider')).toBe('Aga Khan University Hospital');
    expect(await knowledge.topValue(setupId, 'scheme')).toBe('Corporate');
  });
});
