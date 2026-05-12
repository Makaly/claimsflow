import { PartialType } from '@nestjs/mapped-types';
import { CreateProviderDto } from './create-provider.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateProviderDto extends PartialType(CreateProviderDto) {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
