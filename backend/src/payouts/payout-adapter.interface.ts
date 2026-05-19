export type PayoutCarrier = 'mpesa' | 'airtel';

export interface PayoutRequest {
  adviceId: string;
  msisdn: string;          // E.164 without leading +, e.g. 254712345678
  amount: number;          // KES
  reference: string;       // originator conversation id (idempotency key)
  remarks?: string;
}

export interface PayoutResult {
  success: boolean;
  carrierRef?: string;     // carrier-assigned transaction id
  rawResponse?: unknown;
  error?: string;
}

export interface PayoutAdapter {
  readonly carrier: PayoutCarrier;
  initiate(req: PayoutRequest): Promise<PayoutResult>;
}
