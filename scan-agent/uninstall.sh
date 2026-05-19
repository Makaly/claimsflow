#!/usr/bin/env bash
# ClaimsFlow Scan Agent — uninstaller for Linux & macOS
set -euo pipefail

PREFIX="${CLAIMSFLOW_PREFIX:-$HOME/.local}"
BIN_PATH="$PREFIX/bin/claimsflow-scan-agent"
SERVICE_NAME="claimsflow-scan-agent"

OS="$(uname -s)"

say()  { printf '%s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*" >&2; }

say ""
say "ClaimsFlow Scan Agent — uninstalling"
say ""

case "$OS" in
  Linux)
    UNIT="$HOME/.config/systemd/user/${SERVICE_NAME}.service"
    if [ -f "$UNIT" ]; then
      systemctl --user disable --now "${SERVICE_NAME}.service" 2>/dev/null || true
      rm -f "$UNIT"
      systemctl --user daemon-reload 2>/dev/null || true
      ok "Removed systemd user service"
    fi
    ;;
  Darwin)
    PLIST="$HOME/Library/LaunchAgents/com.claimsflow.scan-agent.plist"
    if [ -f "$PLIST" ]; then
      launchctl unload "$PLIST" 2>/dev/null || true
      rm -f "$PLIST"
      ok "Removed launchd agent"
    fi
    ;;
  *)
    warn "Unsupported OS: $OS — only removing the binary."
    ;;
esac

if [ -f "$BIN_PATH" ]; then
  rm -f "$BIN_PATH"
  ok "Removed binary: $BIN_PATH"
else
  warn "Binary not found at $BIN_PATH — nothing to remove."
fi

say ""
ok "ClaimsFlow Scan Agent uninstalled."
say ""
