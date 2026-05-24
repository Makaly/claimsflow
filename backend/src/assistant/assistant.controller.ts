import {
  Controller, Post, Get, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { AssistantService } from './assistant.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

class QueryDto {
  question: string;
}

@Controller('assistant')
@UseGuards(JwtAuthGuard)
export class AssistantController {
  constructor(private service: AssistantService) {}

  @Post('query')
  async query(@Body() dto: QueryDto, @Request() req: any) {
    return this.service.query(req.user?.id, dto.question);
  }

  @Post('index')
  async index() {
    return this.service.indexCorpus();
  }

  @Get('interactions')
  async interactions(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.service.getInteractions(parseInt(page), parseInt(limit));
  }
}
