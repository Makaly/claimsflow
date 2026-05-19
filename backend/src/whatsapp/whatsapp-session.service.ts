import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppAdapter } from './whatsapp-adapter.interface';

// Session state machine:
// idle → awaiting-otp → authenticated → awaiting-image → awaiting-confirm → idle
export type SessionState =
  | 'idle'
  | 'awaiting-otp'
  | 'authenticated'
  | 'awaiting-image'
  | 'awaiting-confirm';

interface Session {
  phone: string;
  state: SessionState;
  otp?: string;
  memberId?: string;
  pendingImageUrl?: string;
  expiresAt: Date;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min inactivity timeout

@Injectable()
export class WhatsAppSessionService {
  private readonly logger = new Logger(WhatsAppSessionService.name);
  // In-memory store; replace with Redis for multi-instance deployments.
  // TODO(prod): swap sessions map for a Redis-backed store
  private sessions = new Map<string, Session>();

  constructor(private readonly adapter: WhatsAppAdapter) {}

  private getOrCreate(phone: string): Session {
    const existing = this.sessions.get(phone);
    if (existing && existing.expiresAt > new Date()) return existing;
    const session: Session = { phone, state: 'idle', expiresAt: new Date(Date.now() + SESSION_TTL_MS) };
    this.sessions.set(phone, session);
    return session;
  }

  private touch(session: Session) {
    session.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  }

  async handle(phone: string, text: string, imageUrl?: string): Promise<void> {
    const session = this.getOrCreate(phone);
    this.touch(session);
    this.logger.debug(`handle phone=${phone} state=${session.state} text="${text}"`);

    switch (session.state) {
      case 'idle':
        await this.startAuth(phone, session);
        break;

      case 'awaiting-otp':
        await this.verifyOtp(phone, session, text.trim());
        break;

      case 'authenticated':
        if (imageUrl) {
          session.pendingImageUrl = imageUrl;
          session.state = 'awaiting-image';
          await this.adapter.sendText({ to: phone, body: 'Image received. Reply YES to submit this invoice or NO to cancel.' });
        } else {
          await this.adapter.sendText({ to: phone, body: 'Please send an image of your invoice, or type HELP for assistance.' });
        }
        break;

      case 'awaiting-image':
        if (imageUrl) {
          session.pendingImageUrl = imageUrl;
          await this.adapter.sendText({ to: phone, body: 'Updated image received. Reply YES to submit or NO to cancel.' });
        } else if (text.toUpperCase() === 'YES') {
          session.state = 'awaiting-confirm';
          await this.confirmSubmission(phone, session);
        } else if (text.toUpperCase() === 'NO') {
          session.pendingImageUrl = undefined;
          session.state = 'authenticated';
          await this.adapter.sendText({ to: phone, body: 'Cancelled. Send a new invoice image when ready.' });
        } else {
          await this.adapter.sendText({ to: phone, body: 'Reply YES to submit or NO to cancel.' });
        }
        break;

      case 'awaiting-confirm':
        // Terminal: reset after confirm
        session.state = 'idle';
        await this.adapter.sendText({ to: phone, body: 'Thank you. Your claim has been queued for processing. You will receive a reference number shortly.' });
        break;

      default:
        session.state = 'idle';
    }
  }

  private async startAuth(phone: string, session: Session): Promise<void> {
    // TODO(prod): generate real OTP, persist with expiry, send via SMS/WhatsApp
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    session.otp = otp;
    session.state = 'awaiting-otp';
    this.logger.log(`OTP for ${phone}: ${otp}`); // dev log — never log in prod
    await this.adapter.sendText({ to: phone, body: `Welcome to ClaimsFlow. Your OTP is ${otp}. Reply with the 6-digit code to continue.` });
  }

  private async verifyOtp(phone: string, session: Session, input: string): Promise<void> {
    if (input === session.otp) {
      session.state = 'authenticated';
      session.otp = undefined;
      await this.adapter.sendText({ to: phone, body: 'Verified! Please send a photo or PDF of the invoice you wish to claim.' });
    } else {
      await this.adapter.sendText({ to: phone, body: 'Incorrect OTP. Please try again or type RESTART to start over.' });
    }
  }

  private async confirmSubmission(phone: string, session: Session): Promise<void> {
    // TODO(prod): push image to OCR pipeline with channel='whatsapp'
    this.logger.log(`WhatsApp claim queued — phone=${phone} imageUrl=${session.pendingImageUrl}`);
    session.pendingImageUrl = undefined;
    await this.adapter.sendText({ to: phone, body: 'Submitting your claim...' });
  }
}
