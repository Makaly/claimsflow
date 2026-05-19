import { Module } from '@nestjs/common';
import { CoverageCalculatorService } from './coverage-calculator.service';
import { CoverageCalculatorController } from './coverage-calculator.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PolicyModule } from '../policy/policy.module';

@Module({
  imports: [PrismaModule, AuthModule, PolicyModule],
  controllers: [CoverageCalculatorController],
  providers: [CoverageCalculatorService],
  exports: [CoverageCalculatorService],
})
export class CoverageCalculatorModule {}
