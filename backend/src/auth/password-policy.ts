import { BadRequestException } from '@nestjs/common';

/**
 * Central password-strength policy. Enforced on registration and on
 * password reset so the two paths cannot drift apart.
 *
 * Rules: minimum 10 characters (consistent with RegisterDto's @MinLength(10))
 * and at least three of the four character classes (lowercase, uppercase,
 * digit, symbol). This resists the trivial dictionary/brute-force exposure of
 * the previous 8-char, no-complexity rule — and crucially applies the SAME bar
 * to the password-reset path, which previously enforced only the 8-char minimum.
 */
export const PASSWORD_MIN_LENGTH = 10;

export function assertStrongPassword(password: string | undefined | null): void {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    throw new BadRequestException(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    );
  }
  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;

  if (classes < 3) {
    throw new BadRequestException(
      'Password must include at least three of: lowercase, uppercase, number, symbol.',
    );
  }
}
