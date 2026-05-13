/**
 * PII redaction helpers for application logs.
 *
 * GDPR Art. 5(1)(f) and Art. 32 require us to apply appropriate technical
 * measures to protect personal data — that includes not writing identifiers
 * straight into stdout where they end up in log aggregators, cold storage,
 * and incident exports. These helpers keep enough of the value to be useful
 * for debugging (first character, domain, last two digits) but redact the
 * identifying portion.
 */

export function redactEmail(value: string | null | undefined): string {
  if (!value) return '[redacted]';
  const at = value.indexOf('@');
  if (at <= 0) return '[redacted]';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const head = local.charAt(0);
  return `${head}***@${domain}`;
}

export function redactPhone(value: string | null | undefined): string {
  if (!value) return '[redacted]';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '[redacted]';
  return `***${digits.slice(-2)}`;
}
