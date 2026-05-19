import {
  Controller, Get, Post, Patch, Param, Body, UseGuards, Request,
} from '@nestjs/common';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('workflow-definitions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'claims_officer')
export class WorkflowDefinitionsController {
  constructor(private svc: WorkflowDefinitionsService) {}

  @Get()
  list() { return this.svc.list(); }

  @Get(':id')
  getById(@Param('id') id: string) { return this.svc.getById(id); }

  @Post()
  create(@Body() body: any, @Request() req: any) {
    return this.svc.create({ ...body, createdBy: req.user.userId });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.svc.update(id, body);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string) { return this.svc.publish(id); }

  @Post('rollback/:name')
  rollback(@Param('name') name: string) { return this.svc.rollback(name); }
}
