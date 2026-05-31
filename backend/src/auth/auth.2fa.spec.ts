import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';
import { EmailOtpService } from './email-otp.service';
import { EventsGateway } from '../notifications/events.gateway';

/**
 * Covers the device-bound email 2FA added for the mobile app: new-device login
 * challenge, trusted-device fast path, OTP verification, and the
 * password-change OTP gate. Uses fully-mocked collaborators so no DB/SMTP is hit.
 */
describe('AuthService — email 2FA', () => {
  let service: AuthService;
  let prisma: any;
  let emailOtp: { sendActionOtp: jest.Mock; verifyActionOtp: jest.Mock };

  const verifiedUser = {
    id: 'u1',
    email: 'jane@example.com',
    password: bcrypt.hashSync('Password!23', 4),
    name: 'Jane',
    role: 'user',
    isActive: true,
    emailVerifiedAt: new Date(),
    providerApprovalStatus: null,
    deletedAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null as Date | null,
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue(verifiedUser) },
      trustedDevice: { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    };
    emailOtp = {
      sendActionOtp: jest.fn().mockResolvedValue({ sent: true }),
      verifyActionOtp: jest.fn().mockResolvedValue({ verified: true }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('signed.jwt.token') } },
        { provide: EmailService, useValue: {} },
        { provide: EmailOtpService, useValue: emailOtp },
        { provide: EventsGateway, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('login with deviceId', () => {
    it('challenges an unknown device with an emailed code instead of a token', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(verifiedUser);
      prisma.trustedDevice.findUnique.mockResolvedValueOnce(null);

      const result: any = await service.login({
        email: 'jane@example.com',
        password: 'Password!23',
        deviceId: 'device-abc',
      });

      expect(result.requiresEmailOtp).toBe(true);
      expect(result.email).toBe('jane@example.com');
      expect(result.access_token).toBeUndefined();
      expect(emailOtp.sendActionOtp).toHaveBeenCalledWith('u1', 'login');
    });

    it('issues a token directly for a trusted device', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(verifiedUser);
      prisma.trustedDevice.findUnique.mockResolvedValueOnce({ id: 'td1', userId: 'u1', deviceId: 'device-abc' });

      const result: any = await service.login({
        email: 'jane@example.com',
        password: 'Password!23',
        deviceId: 'device-abc',
      });

      expect(result.access_token).toBe('signed.jwt.token');
      expect(emailOtp.sendActionOtp).not.toHaveBeenCalled();
      expect(prisma.trustedDevice.update).toHaveBeenCalled();
    });
  });

  describe('verifyLoginOtp', () => {
    it('verifies the code, trusts the device, and issues a token', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(verifiedUser);

      const result = await service.verifyLoginOtp({
        email: 'jane@example.com',
        code: '123456',
        deviceId: 'device-abc',
        deviceLabel: 'Pixel',
        rememberMe: true,
      });

      expect(emailOtp.verifyActionOtp).toHaveBeenCalledWith('u1', '123456', 'login');
      expect(prisma.trustedDevice.upsert).toHaveBeenCalled();
      expect(result.access_token).toBe('signed.jwt.token');
      expect((result.user as any).password).toBeUndefined();
    });
  });

  describe('changePassword OTP gate', () => {
    it('rejects when the supplied otpCode is invalid', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(verifiedUser);
      emailOtp.verifyActionOtp.mockRejectedValueOnce(new BadRequestException('Incorrect code.'));

      await expect(
        service.changePassword('u1', 'Password!23', 'NewPassword!9', '000000'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('updates the password when the otpCode is valid', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(verifiedUser);

      const result = await service.changePassword('u1', 'Password!23', 'NewPassword!9', '123456');

      expect(emailOtp.verifyActionOtp).toHaveBeenCalledWith('u1', '123456', 'password_change');
      expect(prisma.user.update).toHaveBeenCalled();
      expect(result.message).toMatch(/updated/i);
    });
  });
});
