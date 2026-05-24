export interface BookingRequest {
  memberNumber: string;
  providerId: string;
  scheduledAt: Date;
  speciality?: string;
  notes?: string;
}

export interface BookingResult {
  sessionRef: string;
  joinUrl?: string;
  adapterName: string;
}

export interface SessionCompletedPayload {
  sessionRef: string;
  consultationNote: string;
  duration?: number;   // minutes
}

/** All telemedicine adapters must implement this interface. */
export interface TelemedicineAdapter {
  readonly name: string;
  book(request: BookingRequest): Promise<BookingResult>;
  cancel(sessionRef: string): Promise<void>;
}
