#!/usr/bin/env bash
# Build a self-contained Redoc HTML page from the backend's OpenAPI spec.
#
# Usage:
#   ./scripts/build-redoc.sh               # writes site/api/index.html
#   OUT=public/api.html ./scripts/build-redoc.sh
#
# Requires Node 20+ and an environment where the backend can boot at least
# far enough to emit OpenAPI (DATABASE_URL/REDIS_URL can be fake — the spec
# is generated before connections are required when EXIT_AFTER_OPENAPI=1
# is set, but realistically you still need Postgres+Redis available).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/site/api/index.html}"
SPEC="$ROOT/backend/openapi.json"

cd "$ROOT/backend"
echo "==> Emitting OpenAPI spec to $SPEC"
EXPORT_OPENAPI=1 EXIT_AFTER_OPENAPI=1 OPENAPI_OUTPUT="$SPEC" npx ts-node -r tsconfig-paths/register src/main.ts || {
  echo "Backend exited non-zero — spec may still be valid if write happened before exit." >&2
}

if [ ! -s "$SPEC" ]; then
  echo "OpenAPI spec not generated — aborting." >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
cd "$ROOT"
echo "==> Bundling Redoc HTML to $OUT"
npx --yes redoc-cli bundle "$SPEC" -o "$OUT" --options.theme.colors.primary.main='#4f46e5'

echo "==> Done: $OUT"
