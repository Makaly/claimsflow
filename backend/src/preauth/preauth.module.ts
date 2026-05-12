import { Module } from '@nestjs/common';
import { PreAuthService } from './preauth.service';
import { PreAuthController } from './preauth.controller';

@Module({
  controllers: [PreAuthController],
  providers: [PreAuthService],
  exports: [PreAuthService],
})
export class PreAuthModule {}
