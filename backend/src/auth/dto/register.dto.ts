import { IsEmail, IsNotEmpty, IsString, MinLength, Matches, IsOptional, IsIn, Equals } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/, {
    message: 'Password must contain uppercase, lowercase, a number, and a special character',
  })
  password: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  // Public registration cannot self-assign privileged roles.
  // admin / supervisor / claims_officer are created only by existing admins.
  @IsString()
  @IsOptional()
  @IsIn(['provider_admin', 'provider_user'])
  role?: string;

  // GDPR/KDPA Art. 7 — affirmative consent recorded at registration.
  @Equals(true, { message: 'You must accept the Terms of Service and Privacy Policy to register.' })
  acceptTerms: boolean;

  @IsOptional()
  @IsString()
  policyVersion?: string;
}
