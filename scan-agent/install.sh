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
#   CLAIMSFLOW_AUTOSTART=1/0       register service + auto-start on login
#   CLAIMSFLOW_INSTALL_SANE=1/0    install SANE backends via apt/dnf/brew
#   CLAIMSFLOW_VERSION=tag         release tag (default scan-agent-latest)
#   CLAIMSFLOW_PREFIX=path         install prefix (default ~/.local)

set -euo pipefail

# ── Constants ───────────────────────────────────────────────────────────────
REPO="Makaly/claimsflow"
VERSION="${CLAIMSFLOW_VERSION:-scan-agent-latest}"
PREFIX="${CLAIMSFLOW_PREFIX:-$HOME/.local}"
BIN_DIR="$PREFIX/bin"
BIN_NAME="claimsflow-scan-agent"
BIN_PATH="$BIN_DIR/$BIN_NAME"
SERVICE_NAME="claimsflow-scan-agent"
TOTAL_STEPS=5

START_TS=$(date +%s)

# ── Pretty output ───────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
  C_VIOLET=$'\033[35m'; C_CYAN=$'\033[36m'; C_BLUE=$'\033[34m'
  TTY_OUT=1
else
  C_RESET=''; C_BOLD=''; C_DIM=''
  C_GREEN=''; C_YELLOW=''; C_RED=''
  C_VIOLET=''; C_CYAN=''; C_BLUE=''
  TTY_OUT=0
fi

say()  { printf '%b\n' "$*"; }
ok()   { say "    ${C_GREEN}✓${C_RESET} $*"; }
sub()  { say "    ${C_DIM}$*${C_RESET}"; }
warn() { say "    ${C_YELLOW}⚠ $*${C_RESET}" >&2; }
err()  { say "    ${C_RED}✗ $*${C_RESET}" >&2; }
die()  { err "$*"; exit 1; }

STEP_N=0
step() {
  STEP_N=$((STEP_N + 1))
  printf '\n${C_VIOLET}${C_BOLD}[%d/%d]${C_RESET} ${C_BOLD}%s${C_RESET}\n' "$STEP_N" "$TOTAL_STEPS" "$*" \
    | sed "s/\${C_VIOLET}/${C_VIOLET}/g; s/\${C_BOLD}/${C_BOLD}/g; s/\${C_RESET}/${C_RESET}/g"
}

banner() {
  local w=58
  local line
  line=$(printf '%*s' "$w" '' | tr ' ' '═')
  say ""
  say "${C_VIOLET}╔${line}╗${C_RESET}"
  say "${C_VIOLET}║${C_RESET}  ${C_BOLD}ClaimsFlow Scan Agent${C_RESET} — installer                       ${C_VIOLET}║${C_RESET}"
  say "${C_VIOLET}║${C_RESET}  ${C_DIM}https://github.com/$REPO${C_RESET}                       ${C_VIOLET}║${C_RESET}"
  say "${C_VIOLET}╚${line}╝${C_RESET}"
}

success_box() {
  local elapsed=$(($(date +%s) - START_TS))
  local w=58
  local line
  line=$(printf '%*s' "$w" '' | tr ' ' '═')
  say ""
  say "${C_GREEN}╔${line}╗${C_RESET}"
  printf '%b\n' "${C_GREEN}║${C_RESET}  ${C_GREEN}✓${C_RESET} ${C_BOLD}ClaimsFlow Scan Agent installed${C_RESET} in ${C_BOLD}${elapsed}s${C_RESET}$(printf '%*s' $((w - 39 - ${#elapsed})) '')${C_GREEN}║${C_RESET}"
  say "${C_GREEN}╚${line}╝${C_RESET}"
}

# ── Spinner for indeterminate background work ───────────────────────────────
spinner_run() {
  # $1 = label, rest = command + args
  local label="$1"; shift
  local frames='⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏'
  local logf
  logf=$(mktemp -t cf-spin.XXXXXX)
  trap 'rm -f "$logf"' RETURN

  if [ "$TTY_OUT" != "1" ]; then
    # No TTY → just run, no animation
    if "$@" >"$logf" 2>&1; then
      ok "$label"
      return 0
    else
      cat "$logf" >&2
      err "$label"
      return 1
    fi
  fi

  ( "$@" >"$logf" 2>&1 ) &
  local pid=$!
  local i=0
  # Hide cursor
  printf '\033[?25l'
  while kill -0 "$pid" 2>/dev/null; do
    for f in $frames; do
      printf '\r    ${C_CYAN}%s${C_RESET} %s ' "$f" "$label" \
        | sed "s/\${C_CYAN}/${C_CYAN}/g; s/\${C_RESET}/${C_RESET}/g"
      sleep 0.08
      kill -0 "$pid" 2>/dev/null || break
    done
    i=$((i + 1))
  done
  wait "$pid"
  local rc=$?
  printf '\033[?25h\r\033[K'   # show cursor + clear line
  if [ "$rc" -eq 0 ]; then
    ok "$label"
  else
    err "$label (see output below)"
    tail -n 20 "$logf" >&2
  fi
  return "$rc"
}

# ── Interactive prompt ──────────────────────────────────────────────────────
prompt_yes_no() {
  local q="$1" def="$2" reply
  local hint="[${C_BOLD}Y${C_RESET}/n]"; [ "$def" = "n" ] && hint="[y/${C_BOLD}N${C_RESET}]"
  printf '    ${C_VIOLET}?${C_RESET} %s %b ' "$q" "$hint" \
    | sed "s/\${C_VIOLET}/${C_VIOLET}/g; s/\${C_RESET}/${C_RESET}/g"
  read -r reply || reply=""
  reply="${reply:-$def}"
  case "$reply" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# ── Header ──────────────────────────────────────────────────────────────────
banner

# ── Detect OS / arch ────────────────────────────────────────────────────────
UNAME_S="$(uname -s)"; UNAME_M="$(uname -m)"
case "$UNAME_S" in
  Linux)  OS=linux ;;
  Darwin) OS=mac ;;
  *)      die "Unsupported OS: $UNAME_S (on Windows, use ClaimsFlow-Scan-Agent-Setup.exe)" ;;
esac
case "$UNAME_M" in
  x86_64|amd64)  ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *)             die "Unsupported architecture: $UNAME_M" ;;
esac

ASSET_NAME="claimsflow-scan-agent-${OS}-x64"   # only x64 prebuilt today

# ── Detect interactivity ───────────────────────────────────────────────────
if [ -t 0 ] && [ -t 1 ]; then INTERACTIVE=1; else INTERACTIVE=0; fi
AUTOSTART="${CLAIMSFLOW_AUTOSTART:-}"
INSTALL_SANE="${CLAIMSFLOW_INSTALL_SANE:-}"

# ── Pick downloader ────────────────────────────────────────────────────────
if command -v curl >/dev/null 2>&1; then
  DOWNLOADER=curl
elif command -v wget >/dev/null 2>&1; then
  DOWNLOADER=wget
else
  die "Neither curl nor wget found — please install one and re-run."
fi

# ─────────────────────────────────────────────────────────────────────────────
step "Detecting system and gathering options"
sub "Platform:     ${OS} / ${UNAME_M}"
sub "Install path: ${BIN_PATH}"
sub "Release tag:  ${VERSION}"
sub "Downloader:   ${DOWNLOADER}"

if [ "$ARCH" = "arm64" ] && [ "$OS" = "linux" ]; then
  warn "Linux arm64 detected — only x64 prebuilt binaries are published. Falling back may be slow."
fi

if [ -z "$AUTOSTART" ]; then
  if [ "$INTERACTIVE" = "1" ]; then
    if prompt_yes_no "Auto-start the agent on login (recommended)?" y; then AUTOSTART=1; else AUTOSTART=0; fi
  else
    AUTOSTART=1
  fi
fi
if [ -z "$INSTALL_SANE" ]; then
  if [ "$INTERACTIVE" = "1" ]; then
    if prompt_yes_no "Install SANE scanner backends (needs sudo / admin)?" y; then INSTALL_SANE=1; else INSTALL_SANE=0; fi
  else
    INSTALL_SANE=0
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
step "Downloading agent binary (~60 MB)"
mkdir -p "$BIN_DIR"
URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET_NAME"
sub "From: $URL"

TMP="$(mktemp -t claimsflow-agent.XXXXXX)"
trap 'rm -f "$TMP"' EXIT

DL_OK=0
if [ "$DOWNLOADER" = "curl" ]; then
  if [ "$TTY_OUT" = "1" ]; then
    # --progress-bar shows a live [====>    ] bar on stderr
    if curl -fL --retry 3 --retry-delay 2 --progress-bar "$URL" -o "$TMP"; then
      DL_OK=1
    fi
  else
    if curl -fsSL --retry 3 --retry-delay 2 "$URL" -o "$TMP"; then
      DL_OK=1
    fi
  fi
else
  # wget --show-progress gives a similar bar
  if wget -q --show-progress --tries=3 "$URL" -O "$TMP"; then
    DL_OK=1
  fi
fi

if [ "$DL_OK" != "1" ]; then
  err "Download failed."
  err "Check that the release '$VERSION' exists at https://github.com/$REPO/releases"
  exit 1
fi

SIZE=$(wc -c < "$TMP" | tr -d ' ')
if [ "$SIZE" -lt 1000000 ]; then
  err "Downloaded file is only $SIZE bytes — probably a 404 page, not the binary."
  exit 1
fi
install -m 0755 "$TMP" "$BIN_PATH"
ok "Installed to ${C_BOLD}$BIN_PATH${C_RESET} ($((SIZE / 1024 / 1024)) MB)"

# ─────────────────────────────────────────────────────────────────────────────
step "Installing SANE scanner backends"
if [ "$INSTALL_SANE" = "1" ]; then
  if [ "$OS" = "linux" ]; then
    if command -v apt-get >/dev/null 2>&1; then
      sub "Using apt-get (you may be prompted for your sudo password)"
      spinner_run "sudo apt-get update" sudo apt-get update -qq || true
      spinner_run "Installing sane-utils + libsane-common" sudo apt-get install -y sane-utils libsane-common
    elif command -v dnf >/dev/null 2>&1; then
      spinner_run "Installing sane-backends via dnf" sudo dnf install -y sane-backends sane-backends-drivers-scanners
    elif command -v pacman >/dev/null 2>&1; then
      spinner_run "Installing sane via pacman" sudo pacman -S --noconfirm sane
    elif command -v zypper >/dev/null 2>&1; then
      spinner_run "Installing sane-backends via zypper" sudo zypper install -y sane-backends
    else
      warn "Unknown package manager — skipping. See https://sane-project.org/"
    fi
  else
    if command -v brew >/dev/null 2>&1; then
      spinner_run "Installing sane-backends via Homebrew" brew install sane-backends
    else
      warn "Homebrew not found — install from https://brew.sh, then: brew install sane-backends"
    fi
  fi
else
  sub "Skipped — install later with:"
  if [ "$OS" = "linux" ]; then
    sub "  sudo apt install sane-utils    # Debian/Ubuntu"
    sub "  sudo dnf install sane-backends # Fedora"
  else
    sub "  brew install sane-backends"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
step "Registering background service"
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
  systemctl --user enable --now "${SERVICE_NAME}.service" >/dev/null 2>&1
  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$(id -un)" 2>/dev/null || true
  fi
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
    <key>Label</key><string>com.claimsflow.scan-agent</string>
    <key>ProgramArguments</key><array><string>$BIN_PATH</string></array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>$HOME/Library/Logs/claimsflow-scan-agent.log</string>
    <key>StandardErrorPath</key><string>$HOME/Library/Logs/claimsflow-scan-agent.log</string>
    <key>EnvironmentVariables</key>
    <dict><key>SCAN_AGENT_PORT</key><string>7420</string></dict>
</dict>
</plist>
PLIST
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load -w "$plist"
}

if [ "$AUTOSTART" = "1" ]; then
  if [ "$OS" = "linux" ]; then
    if command -v systemctl >/dev/null 2>&1; then
      spinner_run "Registering systemd user service" register_systemd_user
      sub "Manage: ${C_DIM}systemctl --user status ${SERVICE_NAME}${C_RESET}"
    else
      warn "systemctl not found — start manually:  $BIN_PATH"
    fi
  else
    spinner_run "Registering launchd agent" register_launchd
    sub "Logs:   ${C_DIM}~/Library/Logs/claimsflow-scan-agent.log${C_RESET}"
  fi
else
  sub "Skipped. Start manually:  $BIN_PATH"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "Verifying agent is healthy"
HEALTH_OK=0
if [ "$AUTOSTART" = "1" ]; then
  # Give the service a moment to bind the port
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.5
    if curl -fsS -m 2 http://127.0.0.1:7420/health >/dev/null 2>&1; then
      HEALTH_OK=1
      break
    fi
  done
  if [ "$HEALTH_OK" = "1" ]; then
    VER=$(curl -fsS -m 2 http://127.0.0.1:7420/health 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
    ok "Agent is responding on ${C_BOLD}http://127.0.0.1:7420${C_RESET}  ${C_DIM}(v${VER:-?})${C_RESET}"
  else
    warn "Agent isn't responding yet on port 7420 — check service logs:"
    if [ "$OS" = "linux" ]; then
      sub "  journalctl --user -u ${SERVICE_NAME} -n 50"
    else
      sub "  tail -n 50 ~/Library/Logs/claimsflow-scan-agent.log"
    fi
  fi
else
  sub "Skipped (service not auto-started)."
fi

# ── PATH hint ───────────────────────────────────────────────────────────────
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    say ""
    warn "$BIN_DIR is not in your PATH. To run the binary by name later:"
    sub "  export PATH=\"\$HOME/.local/bin:\$PATH\"   # add to ~/.bashrc or ~/.zshrc"
    ;;
esac

# ── Done ────────────────────────────────────────────────────────────────────
success_box
say ""
say "  ${C_BOLD}Next:${C_RESET} open ClaimsFlow → ${C_BOLD}Batch Upload${C_RESET} → ${C_BOLD}Scan Document${C_RESET} → ${C_BOLD}Refresh${C_RESET}."
say "  The agent listens on ${C_BOLD}http://127.0.0.1:7420${C_RESET} (localhost only)."
say ""
