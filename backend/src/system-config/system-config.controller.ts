import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('system-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class SystemConfigController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async getAll() {
    return this.prisma.systemConfig.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] });
  }

  @Put()
  async upsertMany(@Body() body: { configs: Array<{ key: string; value: string; description?: string; category?: string }> }) {
    const results = [];
    for (const cfg of body.configs) {
      const result = await this.prisma.systemConfig.upsert({
        where: { key: cfg.key },
        create: { key: cfg.key, value: cfg.value, description: cfg.description, category: cfg.category },
        update: { value: cfg.value },
      });
      results.push(result);
    }
    return { updated: results.length, configs: results };
  }

  @Get('defaults')
  getDefaults() {
    return [
      { key: 'sla_hours_initial_review', value: '4', category: 'sla', description: 'SLA hours for initial review stage' },
      { key: 'sla_hours_maker_review', value: '24', category: 'sla', description: 'SLA hours for maker review stage' },
      { key: 'sla_hours_checker_review', value: '48', category: 'sla', description: 'SLA hours for checker review stage' },
      { key: 'sla_hours_final_approval', value: '8', category: 'sla', description: 'SLA hours for final approval stage' },
      { key: 'high_value_threshold', value: '200000', category: 'fraud', description: 'KES threshold for high-value claim flag' },
      { key: 'log_retention_days', value: '730', category: 'compliance', description: 'Activity log retention period in days' },
      { key: 'max_daily_submissions', value: '500', category: 'submissions', description: 'Max claims per provider per day' },
      { key: 'appeal_window_days', value: '30', category: 'workflow', description: 'Days after rejection to file an appeal' },
    ];
  }
}
