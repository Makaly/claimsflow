import { Module } from '@nestjs/common';
import { EdmsMockController } from './edms-mock.controller';
import { EoxegenMockController } from './eoxegen-mock.controller';

@Module({
  controllers: [EdmsMockController, EoxegenMockController],
})
export class MockIntegrationsModule {}
