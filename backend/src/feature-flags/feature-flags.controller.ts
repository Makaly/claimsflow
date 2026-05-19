import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, UseGuards,
} from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('feature-flags')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class FeatureFlagsController {
  constructor(private svc: FeatureFlagsService) {}

  @Get()
  list() { return this.svc.list(); }

  @Post()
  create(@Body() body: { key: string; description?: string; enabled?: boolean; targetingJsonb?: any }) {
    return this.svc.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { description?: string; enabled?: boolean; targetingJsonb?: any },
  ) {
    return this.svc.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.svc.delete(id); }
}
