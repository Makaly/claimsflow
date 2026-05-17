import * as crypto from 'crypto';

/**
 * Field-level encryption for special-category personal data (GDPR Art. 9 /
 * KDPA s.44-46).
 *
 * Ciphertext format (single string column):
 *
 *     enc:v1:<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>
 *
 * — AES-256-GCM
 * — 12-byte random IV per row
 * — 16-byte authentication tag (detect tampering)
 * — versioned prefix so we can introduce v2 (different cipher or key rotation
 *   scheme) without breaking existing data
 *
 * Key handling:
 *
 * — The key is read from <code>DATA_ENCRYPTION_KEY</code>. It must be 32 bytes
 *   encoded as 64 hex characters. Generate one with
 *   <code>openssl rand -hex 32</code> and place it in the deployment secret
 *   store, never in source control.
 * — If the variable is missing we throw at first use rather than at startup;
 *   that way local-dev seeds without the variable still run, they just can't
 *   touch encrypted columns until a key is provided.
 *
 * Backward compatibility:
 *
 * — Any value that does *not* start with <code>enc:v1:</code> is returned
 *   untouched on read. That keeps legacy plaintext rows readable until they
 *   are rewritten (the next update of the row produces a ciphertext).
 * — A backfill migration can be added later to re-encrypt existing rows in
 *   place; until then the protection applies to all new and updated data.
 */

const PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = process.env.DATA_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      'DATA_ENCRYPTION_KEY is not configured. Generate one with `openssl rand -hex 32` ' +
        'and store it in the deployment secret store before processing special-category data.',
    );
  }
  return Buffer.from(hex, 'hex');
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptField(plaintext: string | null | undefined): string | null | undefined {
  if (plaintext === null || plaintext === undefined) return plaintext;
  if (plaintext === '') return plaintext;
  if (isEncrypted(plaintext)) return plaintext; // already encrypted — idempotent
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
  } catch (err: any) {
    // Key missing or invalid — store plaintext with a warning so the app
    // remains functional in dev. Production deployments must set
    // DATA_ENCRYPTION_KEY; the startup check in PrismaService logs loudly.
    console.warn('[field-encryption] Encryption skipped — DATA_ENCRYPTION_KEY not set:', err.message);
    return plaintext;
  }
}

export function decryptField(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  if (!isEncrypted(value)) return value; // legacy plaintext — pass through
  const [, , ivB64, tagB64, ctB64] = value.split(':');
  if (!ivB64 || !tagB64 || !ctB64) return value;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]);
    return pt.toString('utf8');
  } catch (err) {
    // Tampered, wrong key, or corrupted row. Surfacing the raw ciphertext
    // would leak nothing useful and decrypting silently to the empty string
    // would mask data loss — fail loud.
    throw new Error('Field decryption failed: authentication tag mismatch or wrong key.');
  }
}
