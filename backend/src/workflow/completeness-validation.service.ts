import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Invoice is the only required document for every claim type.
// Claim forms, authorization letters, discharge summaries, prescriptions, and
// lab results are supporting documents — their absence does not block processing.
// Checkers can manually return a claim to the provider if they determine a
// specific supporting document is needed for that individual claim.
const REQUIRED_DOCUMENTS = {
  inpatient: ['invoice'],
  outpatient: ['invoice'],
  pharmacy:  ['invoice'],
  lab:       ['invoice'],
  default:   ['invoice'],
};

@Injectable()
export class CompletenessValidationService {
  constructor(private prisma: PrismaService) {}

  /**
   * Validate claim completeness
   */
  async validateClaimCompleteness(claimId: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: {
        documents: true,
        provider: true,
      },
    });

    if (!claim) {
      return {
        isComplete: false,
        missingDocuments: [],
        error: 'Claim not found',
      };
    }

    // Determine required documents based on provider type
    const requiredDocs = REQUIRED_DOCUMENTS[claim.provider.type] || REQUIRED_DOCUMENTS.default;

    // Get document types that exist
    const existingDocTypes = claim.documents
      .map((doc) => doc.documentType)
      .filter((type) => type !== null);

    // Find missing documents
    const missingDocuments = requiredDocs.filter(
      (required) => !existingDocTypes.includes(required),
    );

    const isComplete = missingDocuments.length === 0;

    // Update claim
    await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        isComplete,
        missingDocuments,
        completenessCheckedAt: new Date(),
      },
    });

    return {
      isComplete,
      missingDocuments,
      requiredDocuments: requiredDocs,
      existingDocuments: existingDocTypes,
    };
  }

  /**
   * Validate all submitted claims
   */
  async validateAllSubmittedClaims() {
    const claims = await this.prisma.claim.findMany({
      where: {
        status: 'submitted',
        isComplete: false,
      },
    });

    const results = await Promise.all(
      claims.map((claim) => this.validateClaimCompleteness(claim.id)),
    );

    const completeClaims = results.filter((r) => r.isComplete).length;
    const incompleteClaims = results.filter((r) => !r.isComplete).length;

    return {
      total: claims.length,
      complete: completeClaims,
      incomplete: incompleteClaims,
      results,
    };
  }

  /**
   * Mark claim as incomplete and notify provider
   */
  async markAsIncomplete(
    claimId: string,
    missingDocuments: string[],
    reason: string,
  ) {
    const claim = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: 'incomplete',
        isComplete: false,
        missingDocuments,
        rejectionReason: reason,
        workflowStage: 'initial_review',
      },
      include: {
        provider: true,
      },
    });

    // Create status history
    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: 'submitted',
        toStatus: 'incomplete',
        reason: `Missing documents: ${missingDocuments.join(', ')}`,
      },
    });

    return claim;
  }
}
