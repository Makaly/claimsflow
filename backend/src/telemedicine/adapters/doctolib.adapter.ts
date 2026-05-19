import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelemedicineAdapter, BookingRequest, BookingResult } from '../telemedicine.adapter';

/**
 * Stub adapter for Doctolib telemedicine platform.
 * TODO: replace fetch calls with official Doctolib Partner API once credentials are issued.
 * Set TELEMEDICINE_DOCTOLIB_API_KEY in .env.
 */
@Injectable()
export class DoctolibAdapter implements TelemedicineAdapter {
  readonly name = 'doctolib';
  private readonly logger = new Logger(DoctolibAdapter.name);
  private readonly apiKey: string | undefined;

  constructor(private config: ConfigService) {
    this.apiKey = config.get<string>('TELEMEDICINE_DOCTOLIB_API_KEY');
  }

  async book(request: BookingRequest): Promise<BookingResult> {
    if (!this.apiKey) {
      this.logger.warn('Doctolib API key not configured — falling back to stub');
      return {
        sessionRef: `DOCTOLIB-STUB-${Date.now()}`,
        joinUrl: 'https://www.doctolib.fr/stub',
        adapterName: this.name,
      };
    }
    // TODO: POST to https://api.doctolib.com/appointments
    return { sessionRef: `DOCTOLIB-${Date.now()}`, adapterName: this.name };
  }

  async cancel(sessionRef: string): Promise<void> {
    this.logger.log(`[Doctolib stub] cancel ${sessionRef}`);
    // TODO: DELETE https://api.doctolib.com/appointments/{sessionRef}
  }
}
