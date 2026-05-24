import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelemedicineAdapter, BookingRequest, BookingResult } from '../telemedicine.adapter';

/**
 * Stub adapter for Teladoc telemedicine platform.
 * TODO: integrate Teladoc API once TELEMEDICINE_TELADOC_API_KEY is provisioned.
 */
@Injectable()
export class TeladocAdapter implements TelemedicineAdapter {
  readonly name = 'teladoc';
  private readonly logger = new Logger(TeladocAdapter.name);
  private readonly apiKey: string | undefined;

  constructor(private config: ConfigService) {
    this.apiKey = config.get<string>('TELEMEDICINE_TELADOC_API_KEY');
  }

  async book(request: BookingRequest): Promise<BookingResult> {
    if (!this.apiKey) {
      this.logger.warn('Teladoc API key not configured — returning stub');
      return {
        sessionRef: `TELADOC-STUB-${Date.now()}`,
        adapterName: this.name,
      };
    }
    // TODO: POST https://api.teladoc.com/v2/sessions
    return { sessionRef: `TELADOC-${Date.now()}`, adapterName: this.name };
  }

  async cancel(sessionRef: string): Promise<void> {
    this.logger.log(`[Teladoc stub] cancel ${sessionRef}`);
  }
}
