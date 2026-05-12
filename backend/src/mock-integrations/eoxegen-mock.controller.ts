import {
  Controller, Get, Post, Headers, Body, Param, Query, UnauthorizedException, Logger,
} from '@nestjs/common';

interface MockApprovedClaim {
  claimId: string;
  smartClaimId: string;
  smartClaimNumber: string;
  paymentStatus: 'pending' | 'processing' | 'paid';
  paymentDate?: string;
  receivedAt: string;
}

@Controller('mock-eoxegen')
export class EoxegenMockController {
  private readonly logger = new Logger(EoxegenMockController.name);
  private readonly EXPECTED_KEY = 'mock-eoxegen-key-dev';
  private claims = new Map<string, MockApprovedClaim>();
  private claimSeq = 1000;

  // Synthetic member database — these are the only "valid" members in the mock
  private members: Record<string, { name: string; policyStatus: string; benefitBalance: number; planName: string }> = {
    'CIC001': { name: 'James Mwangi', policyStatus: 'active', benefitBalance: 250000, planName: 'Premium Gold' },
    'CIC002': { name: 'Mary Wanjiku', policyStatus: 'active', benefitBalance: 180000, planName: 'Standard Silver' },
    'CIC003': { name: 'Peter Otieno', policyStatus: 'active', benefitBalance: 75000, planName: 'Basic Bronze' },
    'CIC004': { name: 'Anne Kamau', policyStatus: 'lapsed', benefitBalance: 0, planName: 'Premium Gold' },
    'CIC005': { name: 'David Kipchoge', policyStatus: 'active', benefitBalance: 320000, planName: 'Premium Gold' },
  };

  private auth(headers: Record<string, string>) {
    const auth = headers['authorization'] || '';
    if (!auth.startsWith('Bearer ') || auth.slice(7) !== this.EXPECTED_KEY) {
      throw new UnauthorizedException('Mock eOxegen: invalid API key');
    }
  }

  @Post('claims/approved')
  receiveApprovedClaim(@Headers() headers: any, @Body() body: any) {
    this.auth(headers);
    this.claimSeq++;
    const record: MockApprovedClaim = {
      claimId: body.claimId,
      smartClaimId: `SMART-${this.claimSeq}`,
      smartClaimNumber: `SC-${new Date().getFullYear()}-${String(this.claimSeq).padStart(6, '0')}`,
      paymentStatus: 'pending',
      receivedAt: new Date().toISOString(),
    };
    this.claims.set(body.claimId, record);
    this.logger.log(`Mock eOxegen received approved claim: ${body.claimId} → ${record.smartClaimNumber}`);

    // Simulate payment progression after 60s
    setTimeout(() => {
      const c = this.claims.get(body.claimId);
      if (c) { c.paymentStatus = 'processing'; }
    }, 60_000);
    setTimeout(() => {
      const c = this.claims.get(body.claimId);
      if (c) { c.paymentStatus = 'paid'; c.paymentDate = new Date().toISOString(); }
    }, 180_000);

    return record;
  }

  @Get('claims/:claimId/status')
  getClaimStatus(@Headers() headers: any, @Param('claimId') claimId: string) {
    this.auth(headers);
    const c = this.claims.get(claimId);
    if (!c) return { claimId, paymentStatus: 'unknown' };
    return c;
  }

  @Post('members/eligibility')
  checkEligibility(@Headers() headers: any, @Body() body: any) {
    this.auth(headers);
    const num = (body.memberNumber || '').toString().trim().toUpperCase();
    const m = this.members[num];
    if (!m) {
      return {
        memberNumber: num,
        eligible: false,
        policyStatus: 'not_found',
        notes: `Member ${num} not found in eOxegen register`,
      };
    }
    const eligible = m.policyStatus === 'active' && m.benefitBalance > 0;
    return {
      memberNumber: num,
      memberName: m.name,
      eligible,
      policyStatus: m.policyStatus,
      benefitBalance: m.benefitBalance,
      planName: m.planName,
      notes: eligible ? 'Member is eligible' : `Member policy is ${m.policyStatus}`,
    };
  }

  // GET variant for the EligibilityService which uses GET
  @Get('members/eligibility')
  checkEligibilityGet(@Headers() headers: any, @Query('memberNumber') memberNumber: string, @Query('serviceDate') serviceDate?: string) {
    return this.checkEligibility(headers, { memberNumber, serviceDate });
  }

  @Get('health')
  health() {
    return {
      service: 'mock-eoxegen',
      status: 'ok',
      knownClaims: this.claims.size,
      knownMembers: Object.keys(this.members).length,
    };
  }
}
