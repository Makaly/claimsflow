/**
 * Fail-fast environment validation.
 *
 * Runs once at startup, before the Nest application is created. In production it
 * refuses to boot when a security-critical secret is missing, too short, or set
 * to a well-known insecure placeholder. This closes the class of incident where a
 * deployment silently ships with `JWT_SECRET=your-super-secret-jwt-key-change-in-production`
 * (forgeable tokens) or no `DATA_ENCRYPTION_KEY` (special-category PII written in
 * plaintext, GDPR Art. 9 / KDPA s.44-46).
 *
 * Outside production it only warns, so local dev and tests still run without a
 * full secret set.
 */

// Known placeholder / example values that must never reach production.
const INSECURE_SECRETS = new Set([
  'your-super-secret-jwt-key-change-in-production',
  'changeme',
  'secret',
  'test-secret-key',
  'REPLACE_WITH_64_BYTE_RANDOM_HEX',
]);

export function validateEnv(): void {
  const isProd = process.env.NODE_ENV === 'production';
  const problems: string[] = [];

  const jwt = process.env.JWT_SECRET;
  if (!jwt || jwt.trim() === '') {
    problems.push('JWT_SECRET is not set (generate with `openssl rand -hex 64`).');
  } else if (INSECURE_SECRETS.has(jwt.trim())) {
    problems.push('JWT_SECRET is a known insecure placeholder — replace it with a real random value.');
  } else if (jwt.length < 32) {
    problems.push('JWT_SECRET is too short (need 32+ characters; prefer 64 hex bytes).');
  }

  // Special-category PII encryption key. field-encryption.ts requires 64 hex chars.
  const dek = process.env.DATA_ENCRYPTION_KEY;
  if (!dek || dek.trim() === '') {
    problems.push('DATA_ENCRYPTION_KEY is not set (generate with `openssl rand -hex 32`).');
  } else if (!/^[0-9a-f]{64}$/i.test(dek.trim())) {
    problems.push('DATA_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).');
  }

  if (problems.length === 0) return;

  const banner =
    '\n[env-validation] Security-critical configuration problems:\n' +
    problems.map((p) => `  • ${p}`).join('\n') +
    '\n';

  if (isProd) {
    // Hard stop — never boot a production process with forgeable tokens or
    // unencryptable PII.
    console.error(banner + '[env-validation] Refusing to start in production.\n');
    process.exit(1);
  } else {
    console.warn(banner + '[env-validation] Continuing (NODE_ENV is not production).\n');
  }
}
