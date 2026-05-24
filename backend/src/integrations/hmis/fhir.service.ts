import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parseHl7, hl7ToClaimPayload } from './hl7-parser';

/**
 * Handles FHIR R4 resource ingestion and ClaimResponse generation.
 * TODO: validate incoming resources against official FHIR R4 JSON Schema.
 */
@Injectable()
export class FhirService {
  private readonly logger = new Logger(FhirService.name);

  constructor(private prisma: PrismaService) {}

  /** Accept raw HL7 v2 message and auto-create or update a Claim. */
  async ingestHl7(raw: string, providerId: string) {
    const msg = parseHl7(raw);
    if (!['ADT', 'DFT', 'ORM'].includes(msg.type)) {
      throw new BadRequestException(`Unsupported HL7 message type: ${msg.type}`);
    }
    const payload = hl7ToClaimPayload(msg);
    const barcode = `HL7-${Date.now()}`;
    const claimNumber = `HL7-${barcode}`;

    const claim = await this.prisma.claim.create({
      data: {
        claimNumber,
        barcode,
        providerId,
        memberNumber: payload.memberNumber,
        memberName: payload.memberName,
        patientId: payload.patientId,
        diagnosis: payload.diagnosis,
        invoiceAmount: payload.invoiceAmount,
        procedureCodes: payload.procedureCodes,
        structuredSource: true,
        status: 'submitted',
        workflowStage: 'initial_review',
      },
    });

    this.logger.log(`HL7 ${msg.type}^${msg.event} → created claim ${claim.id}`);
    return claim;
  }

  /** Accept a FHIR R4 resource (Claim / Patient / Encounter). */
  async ingestFhirResource(resource: any, providerId: string) {
    const resourceType: string = resource?.resourceType ?? 'Unknown';

    if (resourceType === 'Claim') {
      return this.ingestFhirClaim(resource, providerId);
    }
    // Patient / Encounter are accepted but only logged for now
    // TODO: map Patient → MemberPolicy upsert, Encounter → claim note
    this.logger.log(`FHIR ${resourceType} received for provider ${providerId} — stored as log`);
    return { resourceType, status: 'accepted_no_op' };
  }

  private async ingestFhirClaim(resource: any, providerId: string) {
    const barcode = `FHIR-${Date.now()}`;
    const amount = resource?.total?.value ?? 0;
    const diagnoses: string[] = (resource?.diagnosis ?? []).map(
      (d: any) => d?.diagnosisCodeableConcept?.coding?.[0]?.code ?? '',
    );

    const claim = await this.prisma.claim.create({
      data: {
        claimNumber: barcode,
        barcode,
        providerId,
        invoiceAmount: amount,
        procedureCodes: diagnoses,
        structuredSource: true,
        status: 'submitted',
        workflowStage: 'initial_review',
      },
    });

    return claim;
  }

  /** Generate a FHIR R4 ClaimResponse for a terminal-state claim. */
  async buildClaimResponse(claimId: string): Promise<object> {
    const claim = await this.prisma.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new BadRequestException(`Claim ${claimId} not found`);

    const outcomeMap: Record<string, string> = {
      approved: 'complete',
      rejected: 'error',
      paid: 'complete',
    };

    return {
      resourceType: 'ClaimResponse',
      id: `cr-${claim.id}`,
      status: 'active',
      type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'professional' }] },
      use: 'claim',
      patient: { reference: `Patient/${claim.patientId ?? claim.memberNumber}` },
      created: new Date().toISOString(),
      insurer: { display: 'CIC Insurance Group PLC' },
      request: { reference: `Claim/${claim.id}` },
      outcome: outcomeMap[claim.status] ?? 'queued',
      total: [{ category: { coding: [{ code: 'submitted' }] }, amount: { value: claim.invoiceAmount ?? 0, currency: 'KES' } }],
    };
  }
}
