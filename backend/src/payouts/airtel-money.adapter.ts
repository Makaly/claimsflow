import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PayoutAdapter, PayoutCarrier, PayoutRequest, PayoutResult } from './payout-adapter.interface';

/**
 * Airtel Money Disbursements payout adapter (stub).
 *
 * TODO (B1):
 *  1. Fetch OAuth2 token from Airtel API:
 *       POST https://openapi.airtel.africa/auth/oauth2/token
 *     using AIRTEL_CLIENT_ID / AIRTEL_CLIENT_SECRET.
 *  2. POST to /merchant/v2/payments/ with X-Country / X-Currency headers.
 *  3. Register callback URL via AIRTEL_CALLBACK_URL; handle at
 *       POST /payouts/callback/airtel on this service.
 *  4. Map Airtel response status codes to PayoutResult.
 */
@Injectable()
export class AirtelMoneyAdapter implements PayoutAdapter {
  readonly carrier: PayoutCarrier = 'airtel';
  private readonly logger = new Logger(AirtelMoneyAdapter.name);

  constructor(private cfg: ConfigService) {}

  async initiate(req: PayoutRequest): Promise<PayoutResult> {
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[MOCK] Airtel Money → ${req.msisdn} KES ${req.amount} ref=${req.reference}`);
      return {
        success: true,
        carrierRef: `MOCK-AIRTEL-${Date.now()}`,
      };
    }

    const clientId = this.cfg.get('AIRTEL_CLIENT_ID');
    void clientId;
    throw new Error('AirtelMoneyAdapter: production mode not yet wired — see TODO block');
  }
}
