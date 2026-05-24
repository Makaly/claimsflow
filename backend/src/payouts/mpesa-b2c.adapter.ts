import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PayoutAdapter, PayoutCarrier, PayoutRequest, PayoutResult } from './payout-adapter.interface';

/**
 * Safaricom Daraja B2C (Business-to-Customer) payout adapter.
 *
 * In production, set MPESA_CONSUMER_KEY/SECRET and call the live Daraja
 * /mpesa/b2c/v3/paymentrequest endpoint. In dev (NODE_ENV !== 'production')
 * the adapter short-circuits to a mock success so local dev needs no Daraja
 * credentials.
 *
 * TODO (B1):
 *  1. Replace the mock with a real Daraja OAuth token fetch:
 *       POST https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials
 *     using Buffer.from(`${key}:${secret}`).toString('base64') as Basic auth.
 *  2. Implement real initiate() body per Daraja B2C v3 spec.
 *  3. Handle Daraja ResultCode 0 = success, anything else = failure.
 *  4. Register callback URL via MPESA_CALLBACK_URL env; point it at
 *       POST /payouts/callback/mpesa on this service.
 */
@Injectable()
export class MpesaB2CAdapter implements PayoutAdapter {
  readonly carrier: PayoutCarrier = 'mpesa';
  private readonly logger = new Logger(MpesaB2CAdapter.name);

  constructor(private cfg: ConfigService) {}

  async initiate(req: PayoutRequest): Promise<PayoutResult> {
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[MOCK] M-Pesa B2C → ${req.msisdn} KES ${req.amount} ref=${req.reference}`);
      return {
        success: true,
        carrierRef: `MOCK-MPESA-${Date.now()}`,
      };
    }

    // TODO: replace with real Daraja HTTP call (see class JSDoc)
    const consumerKey = this.cfg.get('MPESA_CONSUMER_KEY');
    const consumerSecret = this.cfg.get('MPESA_SECRET');
    const shortCode = this.cfg.get('MPESA_SHORTCODE');
    void consumerKey; void consumerSecret; void shortCode;

    throw new Error('MpesaB2CAdapter: production mode not yet wired — see TODO block');
  }
}
