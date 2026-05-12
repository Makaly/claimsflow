import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Types for SMS providers
type SmsProvider = 'twilio' | 'africastalking';

interface SendSmsDto {
  phoneNumber: string;
  message: string;
}

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: SmsProvider;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly provider: SmsProvider;
  private twilioClient: any;
  private africasTalkingClient: any;

  constructor(private configService: ConfigService) {
    this.provider = this.configService.get<SmsProvider>('SMS_PROVIDER') || 'africastalking';
    this.initializeProvider();
  }

  /**
   * Initialize SMS provider based on configuration
   */
  private initializeProvider() {
    if (this.provider === 'twilio') {
      this.initializeTwilio();
    } else if (this.provider === 'africastalking') {
      this.initializeAfricasTalking();
    }
  }

  /**
   * Initialize Twilio client
   */
  private initializeTwilio() {
    try {
      const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
      const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');

      if (!accountSid || !authToken) {
        this.logger.warn('Twilio credentials not configured');
        return;
      }

      // Dynamic import to avoid requiring Twilio if not used
      const twilio = require('twilio');
      this.twilioClient = twilio(accountSid, authToken);
      this.logger.log('Twilio SMS client initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Twilio client', error);
    }
  }

  /**
   * Initialize Africa's Talking client
   */
  private initializeAfricasTalking() {
    try {
      const apiKey = this.configService.get<string>('AFRICASTALKING_API_KEY');
      const username = this.configService.get<string>('AFRICASTALKING_USERNAME');

      if (!apiKey || !username) {
        this.logger.warn("Africa's Talking credentials not configured");
        return;
      }

      // Dynamic import
      const AfricasTalking = require('africastalking');
      this.africasTalkingClient = AfricasTalking({
        apiKey,
        username,
      });
      this.logger.log("Africa's Talking SMS client initialized");
    } catch (error) {
      this.logger.error("Failed to initialize Africa's Talking client", error);
    }
  }

  /**
   * Send SMS using configured provider
   */
  async sendSms(dto: SendSmsDto): Promise<SmsResult> {
    if (this.provider === 'twilio') {
      return this.sendViaTwilio(dto);
    } else if (this.provider === 'africastalking') {
      return this.sendViaAfricasTalking(dto);
    }

    return {
      success: false,
      error: 'No SMS provider configured',
      provider: this.provider,
    };
  }

  /**
   * Send SMS via Twilio
   */
  private async sendViaTwilio(dto: SendSmsDto): Promise<SmsResult> {
    try {
      if (!this.twilioClient) {
        throw new Error('Twilio client not initialized');
      }

      const fromNumber = this.configService.get<string>('TWILIO_PHONE_NUMBER');
      if (!fromNumber) {
        throw new Error('Twilio phone number not configured');
      }

      const message = await this.twilioClient.messages.create({
        body: dto.message,
        from: fromNumber,
        to: this.formatPhoneNumber(dto.phoneNumber),
      });

      this.logger.log(`SMS sent via Twilio to ${dto.phoneNumber}: ${message.sid}`);

      return {
        success: true,
        messageId: message.sid,
        provider: 'twilio',
      };
    } catch (error) {
      this.logger.error(`Failed to send SMS via Twilio: ${error.message}`, error);
      return {
        success: false,
        error: error.message,
        provider: 'twilio',
      };
    }
  }

  /**
   * Send SMS via Africa's Talking
   */
  private async sendViaAfricasTalking(dto: SendSmsDto): Promise<SmsResult> {
    try {
      if (!this.africasTalkingClient) {
        throw new Error("Africa's Talking client not initialized");
      }

      const sms = this.africasTalkingClient.SMS;
      const shortCode = this.configService.get<string>('AFRICASTALKING_SHORTCODE');

      const options = {
        to: [this.formatPhoneNumber(dto.phoneNumber)],
        message: dto.message,
      };

      if (shortCode) {
        options['from'] = shortCode;
      }

      const result = await sms.send(options);

      if (result.SMSMessageData.Recipients[0].status === 'Success') {
        this.logger.log(
          `SMS sent via Africa's Talking to ${dto.phoneNumber}: ${result.SMSMessageData.Recipients[0].messageId}`,
        );

        return {
          success: true,
          messageId: result.SMSMessageData.Recipients[0].messageId,
          provider: 'africastalking',
        };
      } else {
        throw new Error(result.SMSMessageData.Recipients[0].status);
      }
    } catch (error) {
      this.logger.error(
        `Failed to send SMS via Africa's Talking: ${error.message}`,
        error,
      );
      return {
        success: false,
        error: error.message,
        provider: 'africastalking',
      };
    }
  }

  /**
   * Format phone number to E.164 format
   * Assumes Kenyan numbers if no country code provided
   */
  private formatPhoneNumber(phoneNumber: string): string {
    // Remove all non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');

    // If starts with 0, replace with 254 (Kenya country code)
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.substring(1);
    }

    // If doesn't start with +, add it
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }

    return cleaned;
  }

  /**
   * Send bulk SMS to multiple recipients
   */
  async sendBulkSms(
    phoneNumbers: string[],
    message: string,
  ): Promise<SmsResult[]> {
    const results = await Promise.allSettled(
      phoneNumbers.map((phoneNumber) =>
        this.sendSms({ phoneNumber, message }),
      ),
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          success: false,
          error: result.reason.message,
          provider: this.provider,
        };
      }
    });
  }

  /**
   * Validate phone number format
   */
  isValidPhoneNumber(phoneNumber: string): boolean {
    // Basic validation - should be 10-15 digits
    const cleaned = phoneNumber.replace(/\D/g, '');
    return cleaned.length >= 10 && cleaned.length <= 15;
  }
}
