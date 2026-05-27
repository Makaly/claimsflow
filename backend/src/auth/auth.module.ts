import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { NotificationsModule } from '../notifications/notifications.module';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { SsoController } from './sso.controller';
import { PassportOidcStrategy } from './strategies/oidc.strategy';
import { PassportSamlStrategy } from './strategies/saml.strategy';
import { EmailOtpService } from './email-otp.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN') || '1d' },
      }),
    }),
    ThrottlerModule.forRoot([
      { name: 'auth', ttl: 60_000, limit: 10 },
    ]),
    NotificationsModule,
  ],
  controllers: [AuthController, UsersController, TwoFactorController, SsoController],
  providers: [AuthService, JwtStrategy, LocalStrategy, TwoFactorService, ConfigService, PassportOidcStrategy, PassportSamlStrategy, EmailOtpService],
  exports: [AuthService, TwoFactorService, EmailOtpService],
})
export class AuthModule {}
