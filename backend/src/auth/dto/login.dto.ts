import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsBoolean()
  @IsOptional()
  rememberMe?: boolean;

  // Stable per-install id sent by the mobile app to opt into device-bound email
  // 2FA: a login from an unknown deviceId triggers an emailed code before a
  // token is issued. Omitted by the web app, which keeps password-only login.
  @IsString()
  @IsOptional()
  deviceId?: string;

  @IsString()
  @IsOptional()
  deviceLabel?: string;
}
