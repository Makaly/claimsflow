import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Shared provider-name → providerId resolver.
 *
 * Used by both ClaimsService (manual/API path) and OcrProcessor (batch
 * auto-detect path) so the same three-step logic governs every lookup:
 *
 *   1. Exact alias hit  — fastest; covers known OCR variants / abbreviations.
 *   2. Fuzzy contains   — case-insensitive substring; no isActive filter so
 *                         pending providers (including previously auto-created
 *                         ones) are found.
 *   3. Auto-create      — creates a pending, inactive provider record so the
 *                         name is preserved and an admin can approve it later,
 *                         rather than silently falling through to "Unknown".
 *
 * Registered in the global CommonModule so no extra module imports are needed.
 */
@Injectable()
export class ProviderResolverService {
  private readonly logger = new Logger(ProviderResolverService.name);

  constructor(private readonly prisma: PrismaService) {}

  normalise(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  async resolve(rawName: string): Promise<string> {
    const normalised = this.normalise(rawName);

    // 1. Exact alias hit
    const aliasHit = await this.prisma.providerAlias.findUnique({
      where: { alias: normalised },
    });
    if (aliasHit) return aliasHit.providerId;

    // 2. Fuzzy name match (no isActive filter — pending providers must be found)
    const provider = await this.prisma.provider.findFirst({
      where: { name: { contains: rawName, mode: 'insensitive' } },
    });

    if (provider) {
      await this.prisma.providerAlias
        .upsert({
          where: { alias: normalised },
          create: { alias: normalised, providerId: provider.id },
          update: {},
        })
        .catch(() => {}); // ignore duplicate on race
      return provider.id;
    }

    // 3. Auto-create a pending record so the name is visible and approvable
    this.logger.warn(`Unknown provider "${rawName}" — creating pending record`);
    const created = await this.prisma.provider.create({
      data: {
        name: rawName,
        type: 'hospital',
        licenseNumber: `AUTO-${Date.now()}`,
        contactPerson: 'Pending',
        email: `pending-${Date.now()}@provider.local`,
        phone: '000',
        physicalAddress: 'Pending',
        status: 'pending',
        approvalStatus: 'pending_approval',
        isActive: false,
        canSubmitClaims: false,
      },
    });
    await this.prisma.providerAlias
      .upsert({
        where: { alias: normalised },
        create: { alias: normalised, providerId: created.id },
        update: {},
      })
      .catch(() => {});
    return created.id;
  }
}
