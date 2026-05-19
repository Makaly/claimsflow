#!/usr/bin/env bash
# ============================================================
#  ClaimsFlow Scan Agent — Linux & macOS Build Script
#
#  Usage (run from scan-agent/):
#      ./build-unix.sh            # builds for current host platform
#      TARGETS=linux ./build-unix.sh
#      TARGETS="linux mac" ./build-unix.sh
#
#  Produces (in dist/):
#      claimsflow-scan-agent-linux-x64
#      claimsflow-scan-agent-mac-x64
#
#  Prerequisites:
#      Node.js 20+ and npm (https://nodejs.org)
# ============================================================
set -euo pipefail

cd "$(dirname "$0")"

# Decide what to build
if [ -n "${TARGETS:-}" ]; then
  read -r -a BUILDS <<< "$TARGETS"
else
  case "$(uname -s)" in
    Linux)  BUILDS=(linux) ;;
    Darwin) BUILDS=(mac) ;;
    *)      BUILDS=(linux mac) ;;
  esac
fi

printf '\n\033[36m═══════════════════════════════════════════════════════\033[0m\n'
printf   '\033[36m  ClaimsFlow Scan Agent — Unix Build\033[0m\n'
printf   '\033[36m═══════════════════════════════════════════════════════\033[0m\n\n'

# ── 1. Install deps ─────────────────────────────────────────
printf '\033[33m[1/3] Installing npm dependencies…\033[0m\n'
npm ci

mkdir -p dist

# ── 2. Build each target ────────────────────────────────────
build_one() {
  local target="$1" out tag size_mb
  case "$target" in
    linux) tag="node20-linux-x64";  out="dist/claimsflow-scan-agent-linux-x64" ;;
    mac)   tag="node20-macos-x64";  out="dist/claimsflow-scan-agent-mac-x64"  ;;
    *) printf '\033[31mUnknown target: %s\033[0m\n' "$target" >&2; return 1 ;;
  esac
  printf '\n\033[33m[2/3] Bundling Node.js + agent → %s…\033[0m\n' "$out"
  npx @yao-pkg/pkg agent.js \
    --target "$tag" \
    --output "$out" \
    --no-bytecode \
    --public \
    --public-packages "*" \
    --compress GZip
  chmod +x "$out"
  size_mb=$(du -m "$out" | awk '{print $1}')
  printf '      \033[32m%s — %s MB\033[0m\n' "$out" "$size_mb"
}

for t in "${BUILDS[@]}"; do
  build_one "$t"
done

# ── 3. Copy installer alongside binaries ────────────────────
cp install.sh   dist/install.sh
cp uninstall.sh dist/uninstall.sh
chmod +x dist/install.sh dist/uninstall.sh

printf '\n\033[32m═══════════════════════════════════════════════════════\033[0m\n'
printf   '\033[32m  ✓ Build complete\033[0m\n'
printf   '\033[32m═══════════════════════════════════════════════════════\033[0m\n\n'
printf '  Artifacts:\n'
ls -lh dist/ | tail -n +2 | awk '{ printf "    %-44s  %s\n", $9, $5 }'
printf '\n  To publish to the scan-agent-latest GitHub release:\n'
printf '    \033[2mgh release upload scan-agent-latest \\ \033[0m\n'
for t in "${BUILDS[@]}"; do
  case "$t" in
    linux) printf '      \033[2mdist/claimsflow-scan-agent-linux-x64 \\ \033[0m\n' ;;
    mac)   printf '      \033[2mdist/claimsflow-scan-agent-mac-x64 \\ \033[0m\n'   ;;
  esac
done
printf '      \033[2mdist/install.sh dist/uninstall.sh --clobber\033[0m\n\n'
