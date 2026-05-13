import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

@Injectable()
export class EligibilityService {
  private readonly logger = new Logger(EligibilityService.name);
  private readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private prisma: PrismaService, private config: ConfigService) {
    this.baseUrl = this.config.get('EOXEGEN_BASE_URL') || '';
    this.apiKey = this.config.get('EOXEGEN_API_KEY') || '';
    this.enabled = !!this.baseUrl && !!this.apiKey;
  }

  async checkEligibility(claimId: string, memberNumber: string, dateOfService?: Date | null): Promise<void> {
    // Always record that we attempted the check
    if (!memberNumber || memberNumber.trim() === '') {
      await this.prisma.claim.update({
        where: { id: claimId },
        data: { eligibilityStatus: 'unknown', eligibilityCheckedAt: new Date(), eligibilityNotes: 'No member number provided' },
      });
      return;
    }

    if (!this.enabled) {
      // Graceful degradation — mark as pending external check
      await this.prisma.claim.update({
        where: { id: claimId },
        data: { eligibilityStatus: 'pending_check', eligibilityCheckedAt: new Date(), eligibilityNotes: 'Eligibility API not configured — manual verification required' },
      });
      return;
    }

    try {
      const response = await axios.get(`${this.baseUrl}/members/eligibility`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        params: { memberNumber: memberNumber.trim(), serviceDate: dateOfService?.toISOString().slice(0, 10) },
        timeout: 10_000,
      });
      const { eligible, notes } = response.data;
      await this.prisma.claim.update({
        where: { id: claimId },
        data: {
          eligibilityStatus: eligible ? 'eligible' : 'ineligible',
          eligibilityCheckedAt: new Date(),
          eligibilityNotes: notes || (eligible ? 'Member is eligible' : 'Member is not eligible or policy is inactive'),
        },
      });
    } catch (e: any) {
      this.logger.warn(`Eligibility check failed for claim ${claimId}: ${e.message}`);
      await this.prisma.claim.update({
        where: { id: claimId },
        data: { eligibilityStatus: 'check_failed', eligibilityCheckedAt: new Date(), eligibilityNotes: `Check failed: ${e.message?.slice(0, 100)}` },
      });
    }
  }
}
