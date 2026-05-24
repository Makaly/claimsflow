import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CoverageCalculatorService, InvoiceLineInput } from './coverage-calculator.service';

class CalculateDto {
  memberId!: string;
  lines!: InvoiceLineInput[];
  date?: string;
}

@Controller('coverage-calculator')
@UseGuards(JwtAuthGuard)
export class CoverageCalculatorController {
  constructor(private readonly svc: CoverageCalculatorService) {}

  @Post('calculate')
  calculate(@Body() dto: CalculateDto) {
    return this.svc.calculate(dto.memberId, dto.lines, dto.date ? new Date(dto.date) : undefined);
  }
}
