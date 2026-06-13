import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JobSetupService } from './job-setup.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('job-setups')
@UseGuards(JwtAuthGuard)
export class JobSetupController {
  constructor(private readonly service: JobSetupService) {}

  // ── Read (any authenticated user — needed to pick a setup at upload) ────────

  @Get()
  list(@Query('active') active?: string, @Request() req?: any) {
    return this.service.list(active === 'true', req?.user?.userId, req?.user?.role);
  }

  @Get('slug/:slug')
  getBySlug(@Param('slug') slug: string) {
    return this.service.getBySlug(slug);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  // ── Auto-populate + learning (used live while indexing) ─────────────────────

  /** Auto-populate: fill what we can from lookups + this setup's own history. */
  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Body()
    body: {
      values: Record<string, any>;
      onlyField?: string;
      useHistory?: boolean;
      context?: { batchName?: string; operator?: string; pageCount?: number; barcode?: string };
    },
  ) {
    return this.service.resolve(id, body?.values ?? {}, {
      onlyField: body?.onlyField,
      useHistory: body?.useHistory,
      context: body?.context,
    });
  }

  /** Validate a value set against this setup's field rules. Returns field errors. */
  @Post(':id/validate')
  async validate(@Param('id') id: string, @Body() body: { values: Record<string, any> }) {
    const errors = await this.service.validate(id, body?.values ?? {});
    return { valid: errors.length === 0, errors };
  }

  /** Record confirmed values into this setup's ISOLATED knowledge base. */
  @Post(':id/learn')
  learn(@Param('id') id: string, @Body() body: { values: Record<string, any> }) {
    return this.service.recordKnowledge(id, body?.values ?? {});
  }

  /** Type-ahead suggestions for one field, scoped to this setup. */
  @Get(':id/suggest')
  suggest(@Param('id') id: string, @Query('field') field: string, @Query('prefix') prefix?: string) {
    return this.service.suggest(id, field, prefix);
  }

  @Get(':id/knowledge/stats')
  knowledgeStats(@Param('id') id: string) {
    return this.service.knowledgeStats(id);
  }

  // ── User assignments ─────────────────────────────────────────────────────────

  @Get(':id/assignments')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  getAssignments(@Param('id') id: string) {
    return this.service.getAssignments(id);
  }

  @Put(':id/assignments')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  setAssignments(@Param('id') id: string, @Body() body: { userIds: string[] }) {
    return this.service.setAssignments(id, body?.userIds ?? []);
  }

  // ── Management (admin / claims_officer) ─────────────────────────────────────

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  create(@Body() body: any, @Request() req: any) {
    return this.service.create(body, req.user?.userId);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/clone')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  clone(@Param('id') id: string, @Request() req: any) {
    return this.service.clone(id, req.user?.userId);
  }

  @Post(':id/fields')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  addField(@Param('id') id: string, @Body() body: any) {
    return this.service.addField(id, body);
  }

  @Patch('fields/:fieldId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  updateField(@Param('fieldId') fieldId: string, @Body() body: any) {
    return this.service.updateField(fieldId, body);
  }

  @Delete('fields/:fieldId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  deleteField(@Param('fieldId') fieldId: string) {
    return this.service.deleteField(fieldId);
  }

  @Delete(':id/knowledge')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  resetKnowledge(@Param('id') id: string) {
    return this.service.resetKnowledge(id);
  }
}
