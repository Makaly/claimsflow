import { IsDateString, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateClaimDto {
  @IsString()
  @IsOptional()
  patientName?: string;

  @IsString()
  @IsOptional()
  patientId?: string;

  @IsString()
  @IsOptional()
  memberNumber?: string;

  @IsString()
  @IsOptional()
  memberName?: string;

  @IsString()
  @IsOptional()
  invoiceNumber?: string;

  @IsString()
  @IsOptional()
  invoiceDate?: string;

  @IsString()
  @IsOptional()
  dateOfService?: string;

  @Transform(({ value }) => value !== undefined && value !== null ? parseFloat(value) : undefined)
  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsUUID()
  @IsOptional()
  providerId?: string;

  @IsString()
  @IsOptional()
  providerName?: string;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsString()
  @IsOptional()
  claimNumber?: string;

  @IsString()
  @IsOptional()
  diagnosis?: string;

  @IsString()
  @IsOptional()
  diagnosisCode?: string;

  @IsString()
  @IsOptional()
  procedureCode?: string;

  @IsString()
  @IsOptional()
  treatment?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsNumber()
  @IsOptional()
  ocrConfidence?: number;

  @IsString()
  @IsOptional()
  recipientEmail?: string;

  @IsString()
  @IsOptional()
  batchNumber?: string;

  @IsString()
  @IsOptional()
  uploadedBy?: string;

  @IsString()
  @IsOptional()
  branchName?: string;

  @IsOptional()
  annotations?: any; // JSON array of PDF annotations (stamps, highlights, signatures, etc.)
}
