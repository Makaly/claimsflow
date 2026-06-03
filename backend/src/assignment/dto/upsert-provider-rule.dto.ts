import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

/**
 * Pin a provider's dedicated reviewers. Either field may be a UUID (assign) or
 * explicit null (clear that pin); omit a field to leave it unchanged.
 */
export class UpsertProviderRuleDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  makerCheckerId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  claimsOfficerId?: string | null;
}
