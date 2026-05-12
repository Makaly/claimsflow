import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, IsIn } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  @IsIn(['admin', 'claims_officer', 'supervisor', 'provider_admin', 'provider_user'])
  role?: string;
}
