import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

// TODO: install passport-saml: npm i passport-saml @node-saml/node-saml
let Strategy: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Strategy = require('passport-saml').Strategy;
} catch {
  Strategy = null;
}

@Injectable()
export class PassportSamlStrategy extends (Strategy ? PassportStrategy(Strategy, 'saml') : class {}) {
  private readonly logger = new Logger(PassportSamlStrategy.name);

  constructor(
    config: ConfigService,
    authService: AuthService,
  ) {
    super(Strategy ? {
      entryPoint: config.get('SSO_ISSUER'),
      issuer: config.get('SSO_CLIENT_ID'),
      callbackUrl: config.get('SSO_REDIRECT_URL'),
      // Fetch IdP metadata dynamically when SAML_METADATA_URL is set.
      // The metadata URL is resolved once on startup; cached for the process lifetime.
      ...(config.get('SAML_METADATA_URL')
        ? { metadataURL: config.get('SAML_METADATA_URL') }
        : {}),
    } : undefined);
    this.config = config;
    this.authService = authService;
  }

  // Property declarations needed since constructor params are not `private` above
  private config: ConfigService;
  private authService: AuthService;

  async validate(profile: any, done: (err: any, user?: any) => void) {
    try {
      const email =
        profile.email ??
        profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] ??
        profile.nameID;
      if (!email) return done(new Error('SAML profile missing email'));

      const name =
        profile.displayName ??
        profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] ??
        email;

      const user = await this.authService.findOrCreateSsoUser({
        email,
        name,
        provider: 'saml',
        externalId: profile.nameID,
      });
      done(null, user);
    } catch (err) {
      this.logger.error('SAML validate error', err);
      done(err);
    }
  }
}
