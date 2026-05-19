import {
  Controller, Post, Get, Body, Headers, Param, UseGuards,
  RawBodyRequest, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { FhirService } from './fhir.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('fhir')
export class HmisController {
  constructor(private fhirService: FhirService) {}

  /** Ingest raw HL7 v2 message. Content-Type: x-application/hl7-v2+er7 */
  @Post('hl7')
  @UseGuards(JwtAuthGuard)
  async ingestHl7(
    @Body() body: Buffer | string,
    @Headers('x-provider-id') providerId: string,
  ) {
    const raw = Buffer.isBuffer(body) ? body.toString('utf-8') : String(body);
    return this.fhirService.ingestHl7(raw, providerId);
  }

  /** FHIR R4 endpoint — accepts Claim / Patient / Encounter */
  @Post()
  @UseGuards(JwtAuthGuard)
  async ingestFhir(
    @Body() resource: any,
    @Headers('x-provider-id') providerId: string,
  ) {
    return this.fhirService.ingestFhirResource(resource, providerId);
  }

  /** Generate FHIR ClaimResponse for a terminal-state claim */
  @Get('claim-response/:claimId')
  @UseGuards(JwtAuthGuard)
  async claimResponse(@Param('claimId') claimId: string) {
    return this.fhirService.buildClaimResponse(claimId);
  }
}
