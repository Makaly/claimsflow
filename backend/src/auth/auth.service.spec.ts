import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';

type PrismaMock = {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
};

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaMock;
  let jwt: { sign: jest.Mock };
  let email: { sendProviderWelcomeEmail: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    email = { sendProviderWelcomeEmail: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: EmailService, useValue: email },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('login', () => {
    const validPasswordHash = bcrypt.hashSync('Password!23', 4);
    const baseUser = {
      id: 'u1',
      email: 'jane@example.com',
      password: validPasswordHash,
      name: 'Jane',
      role: 'user',
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null as Date | null,
    };

    it('issues an access token on valid credentials', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(baseUser);
      prisma.user.update.mockResolvedValueOnce(baseUser);

      const result = await service.login({ email: 'jane@example.com', password: 'Password!23' });

      expect(result.access_token).toBe('signed.jwt.token');
      expect(result.user.email).toBe('jane@example.com');
      expect((result.user as any).password).toBeUndefined();
      expect(jwt.sign).toHaveBeenCalled();
    });

    it('rejects with UnauthorizedException for unknown emails', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.login({ email: 'ghost@example.com', password: 'irrelevant' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when account is currently locked', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        lockedUntil: new Date(Date.now() + 60_000),
      });
      await expect(
        service.login({ email: 'jane@example.com', password: 'Password!23' }),
      ).rejects.toThrow(/locked/i);
    });

    it('increments failedLoginAttempts on wrong password', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(baseUser);
      prisma.user.update.mockResolvedValueOnce(baseUser);

      await expect(
        service.login({ email: 'jane@example.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ failedLoginAttempts: 1 }) }),
      );
    });

    it('locks account after threshold is reached', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ ...baseUser, failedLoginAttempts: 4 });
      prisma.user.update.mockResolvedValueOnce(baseUser);

      await expect(
        service.login({ email: 'jane@example.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const updateCall = prisma.user.update.mock.calls[0][0];
      expect(updateCall.data.failedLoginAttempts).toBe(5);
      expect(updateCall.data.lockedUntil).toBeInstanceOf(Date);
    });

    it('rejects inactive accounts even with correct password', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ ...baseUser, isActive: false });
      await expect(
        service.login({ email: 'jane@example.com', password: 'Password!23' }),
      ).rejects.toThrow(/inactive/i);
    });
  });

  describe('register', () => {
    it('rejects when a user with that email already exists', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'existing' });
      await expect(
        service.register({
          email: 'taken@example.com',
          password: 'Password!23',
          name: 'New',
        } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('hashes the password before persisting', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockImplementation(async ({ data }) => ({
        id: 'u-new',
        ...data,
      }));

      await service.register({
        email: 'new@example.com',
        password: 'Password!23',
        name: 'New',
      } as any);

      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs.data.password).not.toBe('Password!23');
      expect(createArgs.data.password.length).toBeGreaterThan(20);
    });
  });
});
