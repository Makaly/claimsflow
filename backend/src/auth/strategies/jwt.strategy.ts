import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { RbacService } from '../../rbac/rbac.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private rbac: RbacService,
  ) {
    super({
      // Accept JWT from HttpOnly cookie first, then fall back to Bearer header.
      // This supports both the secure cookie path and API clients using Bearer.
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.cookies?.['access_token'] ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
      passReqToCallback: false,
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        providerId: true,
        branchId: true,
        tenantId: true,
        name: true,
        userRoles: {
          include: { role: { select: { name: true, isActive: true } } },
        },
      },
    });
    // Reject if the account no longer exists (deleted) OR has been deactivated.
    // Without the isActive check a disabled/off-boarded user's still-valid JWT
    // would keep working until natural expiry (up to a day) — an access-control
    // gap for leavers and compromised accounts that admins "disable".
    if (!user || !user.isActive) return null;

    const roles = user.userRoles
      .filter((ur) => ur.role.isActive)
      .map((ur) => ur.role.name);
    // Preserve legacy single-role field as one of the roles if the mapping
    // hasn't been populated yet.
    if (user.role && !roles.includes(user.role)) roles.push(user.role);

    const permissions = await this.rbac
      .getUserPermissions(user.id)
      .catch(() => [] as string[]);

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      roles,
      permissions,
      providerId: user.providerId,
      branchId: user.branchId,
      tenantId: user.tenantId,
      name: user.name,
    };
  }
}
