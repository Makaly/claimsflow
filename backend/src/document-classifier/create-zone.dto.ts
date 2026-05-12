import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class CreateZoneDto {
  @IsString()
  fieldName: string;

  @IsString()
  fieldLabel: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  locationContext?: string;

  @IsOptional()
  @IsString()
  searchPhrase?: string;

  @IsOptional()
  @IsString()
  claimField?: string;

  @IsOptional()
  @IsNumber()
  pageNumber?: number;

  @IsNumber()
  @Min(0) @Max(100)
  xPercent: number;

  @IsNumber()
  @Min(0) @Max(100)
  yPercent: number;

  @IsNumber()
  @Min(0) @Max(100)
  widthPercent: number;

  @IsNumber()
  @Min(0) @Max(100)
  heightPercent: number;

  @IsOptional()
  @IsString()
  parentZoneId?: string;

  // Injected by the controller — not validated from client body
  updatedByName?: string;
}
