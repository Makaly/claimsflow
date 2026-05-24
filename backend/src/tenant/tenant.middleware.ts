import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  constructor(
    private prisma: PrismaService,
    private tenantCtx: TenantContextService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const slug = req.headers['x-tenant-slug'] as string | undefined;
    if (slug) {
      const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
      if (tenant && tenant.active) {
        this.tenantCtx.set(tenant.id, slug);
        (req as any).tenantId = tenant.id;
      } else {
        this.logger.warn(`Unknown or inactive tenant slug: ${slug}`);
      }
    }
    next();
  }
}
