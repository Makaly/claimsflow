import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MockTelemedicineAdapter } from './adapters/mock.adapter';
import { DoctolibAdapter } from './adapters/doctolib.adapter';
import { TeladocAdapter } from './adapters/teladoc.adapter';
import { TelemedicineAdapter, BookingRequest, SessionCompletedPayload } from './telemedicine.adapter';

@Injectable()
export class TelemedicineService {
  private readonly adapters: Map<string, TelemedicineAdapter>;
  private readonly defaultAdapter: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private mockAdapter: MockTelemedicineAdapter,
    private doctolibAdapter: DoctolibAdapter,
    private teladocAdapter: TeladocAdapter,
  ) {
    this.adapters = new Map([
      ['mock', mockAdapter],
      ['doctolib', doctolibAdapter],
      ['teladoc', teladocAdapter],
    ]);
    this.defaultAdapter = config.get('TELEMEDICINE_DEFAULT_ADAPTER', 'mock');
  }

  async bookSession(request: BookingRequest, adapterName?: string) {
    const name = adapterName ?? this.defaultAdapter;
    const adapter = this.adapters.get(name) ?? this.mockAdapter;

    // Check outpatient cover before booking (basic eligibility guard)
    const policy = await this.prisma.memberPolicy.findUnique({
      where: { memberNumber: request.memberNumber },
      include: { plan: true },
    });
    if (policy && policy.outpatientUsed >= policy.plan.outpatientLimit) {
      throw new Error('Member has exhausted outpatient benefit limit');
    }

    const result = await adapter.book(request);

    const session = await this.prisma.telemedicineSession.create({
      data: {
        memberNumber: request.memberNumber,
        providerId: request.providerId,
        adapterName: adapter.name,
        sessionRef: result.sessionRef,
        scheduledAt: request.scheduledAt,
        status: 'booked',
      },
    });

    return { session, joinUrl: result.joinUrl };
  }

  /** Webhook: session completed → auto-create claim */
  async sessionCompleted(payload: SessionCompletedPayload) {
    const session = await this.prisma.telemedicineSession.findFirst({
      where: { sessionRef: payload.sessionRef },
    });
    if (!session) throw new NotFoundException(`Session ${payload.sessionRef} not found`);

    const barcode = `TELE-${Date.now()}`;
    const claim = await this.prisma.claim.create({
      data: {
        claimNumber: barcode,
        barcode,
        providerId: session.providerId,
        memberNumber: session.memberNumber,
        notes: payload.consultationNote,
        status: 'submitted',
        workflowStage: 'initial_review',
        structuredSource: true,
      },
    });

    await this.prisma.telemedicineSession.update({
      where: { id: session.id },
      data: { status: 'completed', consultationNote: payload.consultationNote, claimId: claim.id },
    });

    return { claim, session };
  }

  async getSessions(memberNumber?: string) {
    return this.prisma.telemedicineSession.findMany({
      where: memberNumber ? { memberNumber } : undefined,
      orderBy: { scheduledAt: 'desc' },
    });
  }
}
