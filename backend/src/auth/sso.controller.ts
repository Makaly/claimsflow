import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Response,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { MockOidcProvider } from './strategies/mock-oidc.provider';

const SSO_PROVIDER = process.env.SSO_PROVIDER ?? 'oidc'; // 'oidc' | 'saml' | 'mock'

@Controller('auth/sso')
export class SsoController {
  constructor(
    private authService: AuthService,
    private jwtService: JwtService,
  ) {}

  // Initiate OIDC login flow — redirect to IdP.
  @Get('login')
  @UseGuards(AuthGuard(SSO_PROVIDER === 'saml' ? 'saml' : 'oidc'))
  async ssoLogin() {
    // Passport handles the redirect; this body is never reached.
  }

  // OIDC callback from the IdP.
  @Get('callback')
  @UseGuards(AuthGuard(SSO_PROVIDER === 'saml' ? 'saml' : 'oidc'))
  async ssoCallback(@Request() req: any, @Response({ passthrough: true }) res: any) {
    return this.issueSession(req.user, res);
  }

  // SAML assertion consumer endpoint (IdP posts here).
  @Post('callback')
  @HttpCode(302)
  @UseGuards(AuthGuard('saml'))
  async samlAcs(@Request() req: any, @Response({ passthrough: true }) res: any) {
    return this.issueSession(req.user, res);
  }

  // Mock login for local dev (only available when SSO_PROVIDER=mock).
  // TODO: remove or guard with `if (process.env.NODE_ENV !== 'production')`.
  @Post('mock')
  @HttpCode(200)
  async mockLogin(
    @Body() body: { email: string; name: string },
    @Response({ passthrough: true }) res: any,
  ) {
    if (SSO_PROVIDER !== 'mock') {
      throw new BadRequestException('Mock SSO is disabled — set SSO_PROVIDER=mock');
    }
    const profile = MockOidcProvider.buildProfile(body.email, body.name);
    const user = await this.authService.findOrCreateSsoUser({
      email: body.email,
      name: profile.displayName,
      provider: 'mock',
      externalId: profile.id,
    });
    return this.issueSession(user, res);
  }

  // IdP leaver webhook — deactivate user when the IdP removes them.
  // Protect with a shared secret header in production:
  // TODO: add HmacGuard checking X-Leaver-Signature against SSO_WEBHOOK_SECRET.
  @Post('leaver')
  @HttpCode(200)
  async ssoLeaver(@Body() body: { email: string }) {
    if (!body.email) throw new BadRequestException('email required');
    return this.authService.deactivateSsoUser(body.email);
  }

  private issueSession(user: any, res: any) {
    const token = this.jwtService.sign({ sub: user.id, email: user.email });
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('access_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    });
    return { access_token: token, user: { id: user.id, email: user.email, role: user.role } };
  }
}
