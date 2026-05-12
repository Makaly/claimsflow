import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Render polls /api/health from multiple edge nodes and our keep-warm
  // workflow pings every 10 min. Sharing a small egress IP pool trips the
  // 120 req/min global throttler, returns 429, and Render kills the
  // instance as unhealthy — exempting the probe breaks that cycle.
  @SkipThrottle()
  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
