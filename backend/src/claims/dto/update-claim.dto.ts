import { PartialType } from '@nestjs/mapped-types';
import { CreateClaimDto } from './create-claim.dto';
import { IsEnum, IsOptional } from 'class-validator';

enum ClaimStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export class UpdateClaimDto extends PartialType(CreateClaimDto) {
  @IsEnum(ClaimStatus)
  @IsOptional()
  status?: string;
}
