#!/usr/bin/env bash
# ClaimsFlow Scan Agent — universal installer for Linux & macOS
#
# One-liner usage:
#   curl -fsSL https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/install.sh | bash
#
# Interactive (recommended — lets you choose auto-start / SANE install):
#   curl -fsSL https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/install.sh -o install.sh
#   bash install.sh
#
# Non-interactive overrides (env vars):
#   CLAIMSFLOW_AUTOSTART=1   register service + auto-start on login (default in piped mode)
#   CLAIMSFLOW_AUTOSTART=0   install binary only, no service
#   CLAIMSFLOW_INSTALL_SANE=1   try to install SANE backends via apt/dnf/brew
#   CLAIMSFLOW_INSTALL_SANE=0   skip SANE install (default in piped mode)
#   CLAIMSFLOW_VERSION=latest   release tag to download (default: scan-agent-latest)
#   CLAIMSFLOW_PREFIX=$HOME/.local   install prefix (default: ~/.local)

set -euo pipefail

# ── Constants ───────────────────────────────────────────────────────────────
REPO="Makaly/claimsflow"
VERSION="${CLAIMSFLOW_VERSION:-scan-agent-latest}"
PREFIX="${CLAIMSFLOW_PREFIX:-$HOME/.local}"
BIN_DIR="$PREFIX/bin"
BIN_NAME="claimsflow-scan-agent"
BIN_PATH="$BIN_DIR/$BIN_NAME"
SERVICE_NAME="claimsflow-scan-agent"

# ── Pretty output ───────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET='\033[0m'; C_BOLD='\033[1m'; C_DIM='\033[2m'
  C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_VIOLET='\033[35m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_VIOLET=''
fi
say()  { printf '%b\n' "$*"; }
info() { say "${C_VIOLET}▸${C_RESET} $*"; }
ok()   { say "${C_GREEN}✓${C_RESET} $*"; }
warn() { say "${C_YELLOW}⚠${C_RESET} $*" >&2; }
err()  { say "${C_RED}✗${C_RESET} $*" >&2; }
die()  { err "$*"; exit 1; }

say ""
say "${C_BOLD}${C_VIOLET}ClaimsFlow Scan Agent${C_RESET} — installer"
say "${C_DIM}https://github.com/$REPO${C_RESET}"
say ""

# ── Detect OS / arch ────────────────────────────────────────────────────────
UNAME_S="$(uname -s)"
UNAME_M="$(uname -m)"

case "$UNAME_S" in
  Linux)   OS=linux ;;
  Darwin)  OS=mac ;;
  *)       die "Unsupported OS: $UNAME_S (this installer is for Linux and macOS — on Windows, use the .exe installer)" ;;
esac

case "$UNAME_M" in
  x86_64|amd64)   ARCH=x64 ;;
  arm64|aarch64)  ARCH=arm64 ;;
  *)              die "Unsupported architecture: $UNAME_M" ;;
esac

# pkg build matrix currently produces x64 binaries — warn arm64 users
if [ "$ARCH" = "arm64" ] && [ "$OS" = "linux" ]; then
  warn "Linux arm64 detected. Only x64 prebuilt binaries are published — running via Rosetta/qemu may be slow."
  warn "If this fails, build from source: git clone https://github.com/$REPO && cd claims/scan-agent && npm i && npm start"
fi

ASSET_NAME="claimsflow-scan-agent-${OS}-${ARCH}"
# Fallback: only x64 builds are published right now, so for arm64 we ask for x64
[ "$ARCH" = "arm64" ] && ASSET_NAME="claimsflow-scan-agent-${OS}-x64"

info "Detected: ${C_BOLD}$OS / $UNAME_M${C_RESET}"

# ── Pick interactivity defaults ─────────────────────────────────────────────
# A piped script (curl | bash) has no controlling TTY on stdin → fall back to
# env-var defaults instead of prompting (which would hang).
if [ -t 0 ] && [ -t 1 ]; then
  INTERACTIVE=1
else
  INTERACTIVE=0
fi

AUTOSTART="${CLAIMSFLOW_AUTOSTART:-}"
INSTALL_SANE="${CLAIMSFLOW_INSTALL_SANE:-}"

prompt_yes_no() {
  # $1 = question, $2 = default (y|n)
  local q="$1" def="$2" reply
  local hint="[Y/n]"; [ "$def" = "n" ] && hint="[y/N]"
  read -r -p "$(printf '%b ' "${C_VIOLET}?${C_RESET} $q $hint")" reply || reply=""
  reply="${reply:-$def}"
  case "$reply" in
    y|Y|yes|YES) return 0 ;;
    *)            return 1 ;;
  esac
}

if [ -z "$AUTOSTART" ]; then
  if [ "$INTERACTIVE" = "1" ]; then
    if prompt_yes_no "Auto-start the agent on login (recommended)?" y; then
      AUTOSTART=1
    else
      AUTOSTART=0
    fi
  else
    AUTOSTART=1   # default for piped one-liner
  fi
fi

if [ -z "$INSTALL_SANE" ]; then
  if [ "$INTERACTIVE" = "1" ]; then
    if prompt_yes_no "Install SANE scanner backends now (needs sudo / admin)?" y; then
      INSTALL_SANE=1
    else
      INSTALL_SANE=0
    fi
  else
    INSTALL_SANE=0   # don't surprise piped users with sudo prompts
  fi
fi

# ── Sanity: required tools ──────────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || die "Missing required tool: $1"; }
need uname
if command -v curl >/dev/null 2>&1; then
  DOWNLOADER="curl -fsSL --retry 3 --retry-delay 2"
elif command -v wget >/dev/null 2>&1; then
  DOWNLOADER="wget -q -O -"
else
  die "Neither curl nor wget found — please install one and re-run."
fi

# ── Download binary ─────────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET_NAME"

info "Downloading agent binary from $URL"
TMP="$(mktemp -t claimsflow-agent.XXXXXX)"
trap 'rm -f "$TMP"' EXIT

if ! $DOWNLOADER "$URL" > "$TMP"; then
  err "Download failed."
  err "Check that the release '$VERSION' exists at https://github.com/$REPO/releases"
  exit 1
fi

# Sanity-check the file size (real binaries are >5 MB; 404 HTML pages are <1 KB)
SIZE="$(wc -c < "$TMP" | tr -d ' ')"
if [ "$SIZE" -lt 1000000 ]; then
  err "Downloaded file is only $SIZE bytes — probably a 404 page, not the binary."
  err "Inspect: $TMP"
  exit 1
fi

install -m 0755 "$TMP" "$BIN_PATH"
ok "Installed agent to ${C_BOLD}$BIN_PATH${C_RESET}"

# ── Optional: SANE backends ─────────────────────────────────────────────────
install_sane_linux() {
  if command -v apt-get >/dev/null 2>&1; then
    info "Installing SANE via apt-get (you may be prompted for your sudo password)"
    sudo apt-get update -qq
    sudo apt-get install -y sane-utils libsane-common
  elif command -v dnf >/dev/null 2>&1; then
    info "Installing SANE via dnf"
    sudo dnf install -y sane-backends sane-backends-drivers-scanners
  elif command -v pacman >/dev/null 2>&1; then
    info "Installing SANE via pacman"
    sudo pacman -S --noconfirm sane
  elif command -v zypper >/dev/null 2>&1; then
    info "Installing SANE via zypper"
    sudo zypper install -y sane-backends
  else
    warn "Could not detect a supported package manager (apt/dnf/pacman/zypper)."
    warn "Install SANE manually: see https://sane-project.org/"
    return 1
  fi
}

install_sane_mac() {
  if command -v brew >/dev/null 2>&1; then
    info "Installing SANE via Homebrew"
    brew install sane-backends
  else
    warn "Homebrew not found. Install from https://brew.sh then run: brew install sane-backends"
    return 1
  fi
}

if [ "$INSTALL_SANE" = "1" ]; then
  if [ "$OS" = "linux" ]; then
    install_sane_linux || warn "SANE install skipped or failed — agent will still run, but won't see scanners until SANE is installed."
  else
    install_sane_mac   || warn "SANE install skipped or failed."
  fi
else
  warn "Skipped SANE install. To install later:"
  if [ "$OS" = "linux" ]; then
    say "  ${C_DIM}sudo apt install sane-utils${C_RESET}  (Debian/Ubuntu)"
    say "  ${C_DIM}sudo dnf install sane-backends${C_RESET}  (Fedora)"
  else
    say "  ${C_DIM}brew install sane-backends${C_RESET}"
  fi
fi

# ── Auto-start service ──────────────────────────────────────────────────────
register_systemd_user() {
  local unit_dir="$HOME/.config/systemd/user"
  local unit="$unit_dir/${SERVICE_NAME}.service"
  mkdir -p "$unit_dir"
  cat > "$unit" <<UNIT
[Unit]
Description=ClaimsFlow Scan Agent
After=network.target

[Service]
Type=simple
ExecStart=$BIN_PATH
Restart=on-failure
RestartSec=5
Environment=SCAN_AGENT_PORT=7420

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now "${SERVICE_NAME}.service"
  # Persist user session so the service keeps running after logout
  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$(id -un)" 2>/dev/null || true
  fi
  ok "Registered systemd user service: ${C_BOLD}${SERVICE_NAME}.service${C_RESET}"
  ok "Status: ${C_DIM}systemctl --user status ${SERVICE_NAME}${C_RESET}"
}

register_launchd() {
  local plist_dir="$HOME/Library/LaunchAgents"
  local plist="$plist_dir/com.claimsflow.scan-agent.plist"
  mkdir -p "$plist_dir"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>     <string>com.claimsflow.scan-agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$BIN_PATH</string>
    </array>
    <key>RunAtLoad</key>     <true/>
    <key>KeepAlive</key>     <true/>
    <key>StandardOutPath</key>  <string>$HOME/Library/Logs/claimsflow-scan-agent.log</string>
    <key>StandardErrorPath</key><string>$HOME/Library/Logs/claimsflow-scan-agent.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>SCAN_AGENT_PORT</key><string>7420</string>
    </dict>
</dict>
</plist>
PLIST
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load -w "$plist"
  ok "Registered launchd agent: ${C_BOLD}com.claimsflow.scan-agent${C_RESET}"
  ok "Logs: ${C_DIM}$HOME/Library/Logs/claimsflow-scan-agent.log${C_RESET}"
}

if [ "$AUTOSTART" = "1" ]; then
  if [ "$OS" = "linux" ]; then
    if command -v systemctl >/dev/null 2>&1; then
      register_systemd_user
    else
      warn "systemctl not found — falling back to manual start. Run: $BIN_PATH"
    fi
  else
    register_launchd
  fi
else
  info "Skipped auto-start setup. Start the agent manually:"
  say  "  ${C_DIM}$BIN_PATH${C_RESET}"
fi

# ── PATH hint ───────────────────────────────────────────────────────────────
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    warn "$BIN_DIR is not in your PATH."
    say  "  Add this to your shell rc (~/.bashrc, ~/.zshrc):"
    say  "  ${C_DIM}export PATH=\"\$HOME/.local/bin:\$PATH\"${C_RESET}"
    ;;
esac

# ── Done ────────────────────────────────────────────────────────────────────
say ""
ok "${C_BOLD}ClaimsFlow Scan Agent installed.${C_RESET}"
say ""
say "Next step: open ClaimsFlow in your browser and click ${C_BOLD}Refresh${C_RESET} on the Scan Document tab."
say "The agent is listening on ${C_BOLD}http://127.0.0.1:7420${C_RESET} (localhost only)."
say ""
