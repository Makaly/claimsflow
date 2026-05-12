import { IsEmail, IsNotEmpty, IsString, MinLength, Matches, IsOptional, IsIn } from 'class-validator';

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
}
