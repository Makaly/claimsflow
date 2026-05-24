import { Module } from '@nestjs/common';
import { BankReconService } from './bank-recon.service';
import { BankReconController } from './bank-recon.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [BankReconController],
  providers: [BankReconService],
  exports: [BankReconService],
})
export class BankReconModule {}
