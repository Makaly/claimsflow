import { Injectable } from '@nestjs/common';
import { TelemedicineAdapter, BookingRequest, BookingResult } from '../telemedicine.adapter';

@Injectable()
export class MockTelemedicineAdapter implements TelemedicineAdapter {
  readonly name = 'mock';

  async book(request: BookingRequest): Promise<BookingResult> {
    const sessionRef = `MOCK-${Date.now()}-${request.memberNumber}`;
    return {
      sessionRef,
      joinUrl: `https://mock.telemedicine.local/session/${sessionRef}`,
      adapterName: this.name,
    };
  }

  async cancel(_sessionRef: string): Promise<void> {
    // No-op for mock
  }
}
