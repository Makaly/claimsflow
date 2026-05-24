import {
  Controller, Post, Get, Body, Query, UseGuards,
} from '@nestjs/common';
import { TelemedicineService } from './telemedicine.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('telemedicine')
@UseGuards(JwtAuthGuard)
export class TelemedicineController {
  constructor(private service: TelemedicineService) {}

  @Post('sessions')
  book(@Body() body: {
    memberNumber: string;
    providerId: string;
    scheduledAt: string;
    speciality?: string;
    adapter?: string;
  }) {
    return this.service.bookSession(
      { ...body, scheduledAt: new Date(body.scheduledAt) },
      body.adapter,
    );
  }

  @Post('webhook/session-completed')
  sessionCompleted(@Body() payload: {
    sessionRef: string;
    consultationNote: string;
    duration?: number;
  }) {
    return this.service.sessionCompleted(payload);
  }

  @Get('sessions')
  getSessions(@Query('memberNumber') memberNumber?: string) {
    return this.service.getSessions(memberNumber);
  }
}
