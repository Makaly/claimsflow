import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);
  private app: admin.app.App | null = null;

  constructor(private config: ConfigService) {
    const raw = config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (!raw) {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON not set — FCM push disabled');
      return;
    }
    try {
      const serviceAccount = JSON.parse(raw);
      // Reuse the default app if already initialized (hot-reload safe).
      this.app = admin.apps.length
        ? admin.app()
        : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (e) {
      this.logger.error(`Failed to init Firebase Admin: ${(e as Error).message}`);
    }
  }

  /** Send a push notification to one FCM token. Returns true on success. */
  async send(token: string, title: string, body: string, data?: Record<string, string>): Promise<boolean> {
    if (!this.app) return false;
    try {
      await admin.messaging(this.app).send({
        token,
        notification: { title, body },
        data: data ?? {},
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default', badge: 1 } } },
      });
      return true;
    } catch (e: any) {
      // Remove stale / unregistered tokens automatically.
      const stale = e.code === 'messaging/registration-token-not-registered'
        || e.code === 'messaging/invalid-registration-token';
      this.logger.warn(`FCM send failed (token …${token.slice(-8)}): ${e.message}${stale ? ' [stale]' : ''}`);
      return false;
    }
  }

  /** Send to multiple tokens; returns count of successes. */
  async sendToTokens(tokens: string[], title: string, body: string, data?: Record<string, string>): Promise<number> {
    if (!tokens.length || !this.app) return 0;
    const results = await Promise.allSettled(tokens.map((t) => this.send(t, title, body, data)));
    return results.filter((r) => r.status === 'fulfilled' && r.value).length;
  }
}
