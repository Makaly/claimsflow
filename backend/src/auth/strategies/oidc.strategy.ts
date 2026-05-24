import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

// TODO: install passport-openidconnect: npm i passport-openidconnect @types/passport-openidconnect
// Using dynamic require so the module compiles even when the package is absent in dev.
let Strategy: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Strategy = require('passport-openidconnect').Strategy;
} catch {
  Strategy = null;
}

@Injectable()
export class PassportOidcStrategy extends (Strategy ? PassportStrategy(Strategy, 'oidc') : class {}) {
  private readonly logger = new Logger(PassportOidcStrategy.name);

  constructor(
    config: ConfigService,
    authService: AuthService,
  ) {
    super(Strategy ? {
      issuer: config.get('SSO_ISSUER'),
      authorizationURL: `${config.get('SSO_ISSUER')}/authorize`,
      tokenURL: `${config.get('SSO_ISSUER')}/token`,
      userInfoURL: `${config.get('SSO_ISSUER')}/userinfo`,
      clientID: config.get('SSO_CLIENT_ID'),
      clientSecret: config.get('SSO_CLIENT_SECRET'),
      callbackURL: config.get('SSO_REDIRECT_URL'),
      scope: ['openid', 'email', 'profile'],
    } : undefined);
    this.config = config;
    this.authService = authService;
  }

  // Property declarations needed since constructor params are not `private` above
  private config: ConfigService;
  private authService: AuthService;

  async validate(
    _issuer: string,
    _sub: string,
    profile: any,
    _accessToken: string,
    _refreshToken: string,
    done: (err: any, user?: any) => void,
  ) {
    try {
      const email =
        profile.emails?.[0]?.value ??
        profile._json?.email ??
        profile.email;
      if (!email) return done(new Error('OIDC profile missing email'));

      const user = await this.authService.findOrCreateSsoUser({
        email,
        name: profile.displayName ?? email,
        provider: 'oidc',
        externalId: profile.id,
      });
      done(null, user);
    } catch (err) {
      this.logger.error('OIDC validate error', err);
      done(err);
    }
  }
}
