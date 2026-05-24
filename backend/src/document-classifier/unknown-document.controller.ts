import {
  Controller, Get, Patch, Post, Delete, Param, Body, Query, Res,
  UseGuards, Request, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { UnknownDocumentService } from './unknown-document.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('unknown-documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'maker_checker')
export class UnknownDocumentController {
  constructor(private readonly service: UnknownDocumentService) {}

  @Get('count')
  getPendingCount() {
    return this.service.getPendingCount().then((count) => ({ count }));
  }

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll({
      status,
      page:  page  ? parseInt(page,  10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/file')
  async serveFile(@Param('id') id: string, @Res() res: Response) {
    return this.service.serveSample(id, res);
  }

  @Patch(':id/review')
  @HttpCode(HttpStatus.OK)
  markReviewed(
    @Param('id') id: string,
    @Body() body: { notes?: string },
    @Request() req: any,
  ) {
    return this.service.markReviewed(id, req.user.id, body.notes);
  }

  @Patch(':id/template-created')
  @HttpCode(HttpStatus.OK)
  markTemplateCreated(@Param('id') id: string, @Request() req: any) {
    return this.service.markTemplateCreated(id, req.user.id);
  }

  @Post(':id/promote-to-template')
  @HttpCode(HttpStatus.OK)
  promoteToTemplate(
    @Param('id') id: string,
    @Body() body: { templateId: string },
    @Request() req: any,
  ) {
    return this.service.promoteToTemplate(id, body.templateId, req.user.id);
  }

  @Post(':id/create-template')
  @HttpCode(HttpStatus.OK)
  createTemplateFromUnknown(
    @Param('id') id: string,
    @Body() body: { name: string; documentType: string; description?: string; providerType?: string; specificProvider?: string },
    @Request() req: any,
  ) {
    return this.service.createTemplateFromUnknown(id, body, req.user.id);
  }

  @Post(':id/ensure-draft-template')
  @HttpCode(HttpStatus.OK)
  ensureDraftTemplate(@Param('id') id: string, @Request() req: any) {
    return this.service.ensureDraftTemplate(id, req.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
  }
}
