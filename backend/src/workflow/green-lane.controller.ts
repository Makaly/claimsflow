import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { GreenLaneService } from './green-lane.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('workflow/green-lane')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GreenLaneController {
  constructor(private service: GreenLaneService) {}

  @Get('rules')
  @Roles('admin', 'claims_officer')
  listRules() {
    return this.service.listRules();
  }

  @Post('rules')
  @Roles('admin')
  createRule(@Body() dto: any) {
    return this.service.createRule(dto);
  }

  @Patch('rules/:id')
  @Roles('admin')
  updateRule(@Param('id') id: string, @Body() dto: any) {
    return this.service.updateRule(id, dto);
  }

  @Delete('rules/:id')
  @Roles('admin')
  deleteRule(@Param('id') id: string) {
    return this.service.deleteRule(id);
  }

  @Post('rules/evaluate/:claimId')
  @Roles('admin', 'claims_officer')
  evaluate(@Param('claimId') claimId: string) {
    return this.service.evaluateClaim(claimId);
  }

  @Patch('global-enabled')
  @Roles('admin')
  setGlobal(@Body('enabled') enabled: boolean) {
    return this.service.setGlobalEnabled(enabled);
  }

  @Get('daily-summary')
  @Roles('admin', 'claims_officer')
  dailySummary(@Query('date') date?: string) {
    return this.service.dailySummary(date ? new Date(date) : undefined);
  }
}
