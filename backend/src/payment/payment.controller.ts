import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request, Res } from '@nestjs/common';
import { Response } from 'express';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('payment')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('pending')
  @Roles('admin', 'finance', 'claims_officer')
  getPending(@Query('providerId') providerId?: string) {
    return this.paymentService.getPendingPayment(providerId);
  }

  @Post('advices')
  @Roles('admin', 'finance', 'claims_officer')
  generateAdvice(
    @Body() body: { providerId: string; claimIds: string[]; notes?: string },
    @Request() req,
  ) {
    return this.paymentService.generatePaymentAdvice({ ...body, generatedBy: req.user.userId });
  }

  @Get('advices')
  @Roles('admin', 'finance', 'claims_officer')
  getAdvices(
    @Query('status') status?: string,
    @Query('providerId') providerId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.paymentService.getPaymentAdvices({
      status,
      providerId,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Patch('advices/:id/confirm')
  @Roles('admin', 'finance', 'claims_officer')
  confirm(
    @Param('id') id: string,
    @Body() body: { paymentReference: string; paymentDate?: string },
    @Request() req,
  ) {
    return this.paymentService.confirmPayment(id, req.user.userId, body);
  }

  @Get('advices/:id/export')
  @Roles('admin', 'finance', 'claims_officer')
  async exportCsv(@Param('id') id: string, @Res() res: Response) {
    const csv = await this.paymentService.exportPaymentFile(id);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payment-${id}.csv"`);
    res.send(csv);
  }
}
