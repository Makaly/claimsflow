import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Blocks provider_admin / provider_user requests when the provider record
 * isn't fully approved yet. Providers can log in before approval, but they
 * may NOT submit claims/upload invoices until CIC staff approve their account.
 *
 * Non-provider users (admin, supervisor, claims_officer, etc.) always pass.
 */
@Injectable()
export class ProviderApprovedGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new ForbiddenException('Not authenticated');

    const role = user.role;
    const isProvider = role === 'provider_admin' || role === 'provider_user';
    if (!isProvider) return true;

    if (!user.providerId) {
      throw new ForbiddenException(
        'Your account is not linked to a provider. Contact CIC support.',
      );
    }

    const provider = await this.prisma.provider.findUnique({
      where: { id: user.providerId },
      select: {
        approvalStatus: true,
        status: true,
        canSubmitClaims: true,
        isActive: true,
        rejectionReason: true,
      },
    });
    if (!provider) throw new ForbiddenException('Provider record not found');

    if (provider.approvalStatus === 'rejected') {
      throw new ForbiddenException(
        `Your provider registration was rejected${provider.rejectionReason ? `: ${provider.rejectionReason}` : ''}. You cannot submit invoices.`,
      );
    }
    if (provider.approvalStatus !== 'approved' || !provider.canSubmitClaims) {
      throw new ForbiddenException(
        'Your provider account is pending approval. You cannot submit invoices until CIC staff approve the account.',
      );
    }
    if (!provider.isActive || provider.status === 'suspended') {
      throw new ForbiddenException(
        'Your provider account is currently suspended. Contact CIC support.',
      );
    }
    return true;
  }
}
