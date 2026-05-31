#!/usr/bin/env bash
# ============================================================
#  Authenticode-sign a Windows .exe on Linux with osslsigncode.
#
#  Usage:  bash scripts/sign-windows.sh <path-to-exe>
#
#  Signs IN PLACE when a code-signing certificate is provided via env vars;
#  otherwise logs a notice and exits 0 so unsigned CI builds still succeed.
#
#  Required env (set as CircleCI / CI secret env vars):
#    WINDOWS_CERT_BASE64    base64 of your code-signing .pfx / .p12
#    WINDOWS_CERT_PASSWORD  the .pfx password
#  Optional:
#    WINDOWS_CERT_NAME      friendly name shown in the UAC prompt
#                           (default: "ClaimsFlow Scan Agent")
#    WINDOWS_CERT_URL       publisher URL embedded in the signature
#    TSA_URL                RFC-3161 timestamp authority
#                           (default: http://timestamp.sectigo.com)
#
#  To produce WINDOWS_CERT_BASE64 from a .pfx:
#    base64 -w0 your-cert.pfx        # Linux
#    base64 -i your-cert.pfx         # macOS
# ============================================================
set -euo pipefail

TARGET="${1:?usage: sign-windows.sh <exe>}"
CERT_NAME="${WINDOWS_CERT_NAME:-ClaimsFlow Scan Agent}"
CERT_URL="${WINDOWS_CERT_URL:-https://claimsflow-frontend.onrender.com}"
TSA_URL="${TSA_URL:-http://timestamp.sectigo.com}"

if [ ! -f "$TARGET" ]; then
  echo "✗ sign-windows: target not found: $TARGET" >&2
  exit 1
fi

if [ -z "${WINDOWS_CERT_BASE64:-}" ] || [ -z "${WINDOWS_CERT_PASSWORD:-}" ]; then
  echo "ℹ  sign-windows: WINDOWS_CERT_BASE64 / WINDOWS_CERT_PASSWORD not set."
  echo "   Skipping signing — '$TARGET' ships UNSIGNED (SmartScreen may warn)."
  echo "   Add the secrets in CircleCI → Project Settings → Environment Variables."
  exit 0
fi

if ! command -v osslsigncode >/dev/null 2>&1; then
  echo "✗ sign-windows: osslsigncode not installed (apt-get install -y osslsigncode)" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
CERT="$WORK/cert.p12"
SIGNED="$WORK/signed.exe"

echo "$WINDOWS_CERT_BASE64" | base64 -d > "$CERT"

echo "→ Signing $TARGET (SHA-256, timestamped via $TSA_URL)…"
osslsigncode sign \
  -pkcs12 "$CERT" \
  -pass "$WINDOWS_CERT_PASSWORD" \
  -n "$CERT_NAME" \
  -i "$CERT_URL" \
  -h sha256 \
  -ts "$TSA_URL" \
  -in "$TARGET" \
  -out "$SIGNED"

mv -f "$SIGNED" "$TARGET"

echo "→ Verifying signature…"
osslsigncode verify "$TARGET" || {
  echo "✗ sign-windows: verification failed" >&2
  exit 1
}
echo "✓ Signed: $TARGET"
