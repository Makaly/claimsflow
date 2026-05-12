import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  Min,
} from 'class-validator';

enum ProviderType {
  HOSPITAL = 'hospital',
  CLINIC = 'clinic',
  PHARMACY = 'pharmacy',
  LAB = 'lab',
}

enum CompanyStructure {
  SOLE_PROPRIETORSHIP = 'sole_proprietorship',
  PARTNERSHIP = 'partnership',
  REGISTERED_COMPANY = 'registered_company',
}

export class CreateProviderDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(ProviderType)
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsNotEmpty()
  contactPerson: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  licenseNumber: string;

  @IsString()
  @IsNotEmpty()
  physicalAddress: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  region?: string;

  @IsString()
  @IsOptional()
  alternatePhone?: string;

  // ── Company Profile ───────────────────────────────────────────────────────

  @IsEnum(CompanyStructure)
  @IsOptional()
  companyStructure?: string;

  /** Companies Registry / CAK registration number */
  @IsString()
  @IsOptional()
  registrationNumber?: string;

  /** KRA Tax PIN */
  @IsString()
  @IsOptional()
  kraPin?: string;

  /** ISO date string – controller converts to Date */
  @IsString()
  @IsOptional()
  incorporationDate?: string;

  /** Number of partners (partnership only) */
  @IsInt()
  @Min(2)
  @IsOptional()
  numberOfPartners?: number;

  /** Full name of sole proprietor */
  @IsString()
  @IsOptional()
  ownerName?: string;

  /** National ID / passport of sole proprietor */
  @IsString()
  @IsOptional()
  ownerIdNumber?: string;

  /** Set by the controller after file upload */
  @IsString()
  @IsOptional()
  proofDocumentPath?: string;

  @IsString()
  @IsOptional()
  proofDocumentName?: string;
}
