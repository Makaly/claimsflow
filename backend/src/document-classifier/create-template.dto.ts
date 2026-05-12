import { IsString, IsOptional } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  name: string;

  @IsString()
  documentType: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  providerType?: string;

  @IsOptional()
  @IsString()
  specificProvider?: string;
}
