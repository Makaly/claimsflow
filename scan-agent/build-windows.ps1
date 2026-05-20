# ============================================================
#  ClaimsFlow Scan Agent — Windows Build Script
#
#  Usage (run from scan-agent\ in PowerShell as Administrator):
#      .\build-windows.ps1
#
#  What it does:
#    1. Installs npm dependencies
#    2. Generates installer graphics (dark-branded BMPs)
#    3. Bundles Node.js + agent into a single .exe via @yao-pkg/pkg
#    4. Downloads WinSW (Windows service wrapper) if missing
#    5. Compiles the modern Inno Setup 6 installer
#
#  Output:  .\ClaimsFlow-Scan-Agent-Setup.exe
#
#  Prerequisites (install once):
#    Node.js 20+   https://nodejs.org
#    Inno Setup 6  https://jrsoftware.org/isdl.php
#                  (or: winget install JRSoftware.InnoSetup)
# ============================================================

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

# ── Helpers ──────────────────────────────────────────────────────────────────
function Write-Step($n, $total, $msg) {
    Write-Host ""
    Write-Host "  [$n/$total] $msg" -ForegroundColor Cyan
}
function Write-Ok($msg)   { Write-Host "        ✓  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "        ⚠  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "        ✗  $msg" -ForegroundColor Red }

$STEPS = 5

# ── Banner ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "  ║   ClaimsFlow Scan Agent  ·  Windows Installer Build      ║" -ForegroundColor Blue
Write-Host "  ║   CIC Insurance Group PLC  ·  v1.1.0                     ║" -ForegroundColor Blue
Write-Host "  ╚══════════════════════════════════════════════════════════╝" -ForegroundColor Blue
Write-Host ""

# ── Step 1: npm install ───────────────────────────────────────────────────────
Write-Step 1 $STEPS "Installing npm dependencies"
npm ci --silent
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
Write-Ok "node_modules ready"

# ── Step 2: Generate installer assets ────────────────────────────────────────
Write-Step 2 $STEPS "Generating installer graphics (pure-JS, no native deps)"
New-Item -ItemType Directory -Force -Path assets | Out-Null


node scripts\generate-installer-assets.js
if ($LASTEXITCODE -ne 0) { throw "Asset generation failed" }

@('wizard-sidebar.bmp','wizard-header.bmp','setup-splash.bmp') | ForEach-Object {
    if (Test-Path "assets\$_") { Write-Ok $_ }
    else { Write-Warn "$_ not generated — installer will use defaults" }
}

# ── Step 3: Bundle Node.js + agent → single .exe ─────────────────────────────
Write-Step 3 $STEPS "Bundling Node.js + agent into standalone Windows .exe"
New-Item -ItemType Directory -Force -Path dist | Out-Null

npx --yes @yao-pkg/pkg agent.js `
    --target node20-win-x64 `
    --output dist\claimsflow-scan-agent.exe `
    --compress GZip `
    --assets "drivers/**"

if (-not (Test-Path "dist\claimsflow-scan-agent.exe")) {
    throw "pkg build failed — dist\claimsflow-scan-agent.exe not produced"
}

$agentMb = [math]::Round((Get-Item "dist\claimsflow-scan-agent.exe").Length / 1MB, 1)
Write-Ok "dist\claimsflow-scan-agent.exe  ($agentMb MB)"

# ── Step 4: Download WinSW ────────────────────────────────────────────────────
Write-Step 4 $STEPS "Ensuring WinSW (Windows service wrapper) is present"

if (-not (Test-Path "winsw.exe")) {
    $winswUrl = "https://github.com/winsw/winsw/releases/download/v3.0.0-alpha.11/WinSW-x64.exe"
    Write-Host "        Downloading WinSW from GitHub…" -ForegroundColor Gray
    try {
        Invoke-WebRequest -Uri $winswUrl -OutFile winsw.exe -UseBasicParsing
        Write-Ok "winsw.exe downloaded"
    } catch {
        # Fallback: check if already available from a previous build
        Write-Warn "Download failed — ensure winsw.exe is present manually"
        Write-Host "        URL: $winswUrl" -ForegroundColor DarkGray
    }
} else {
    $winswKb = [math]::Round((Get-Item winsw.exe).Length / 1KB, 0)
    Write-Ok "winsw.exe already present  ($winswKb KB)"
}

# ── Step 5: Compile Inno Setup 6 installer ────────────────────────────────────
Write-Step 5 $STEPS "Compiling Inno Setup 6 installer (.exe)"

# Locate iscc.exe
$isccCandidates = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    (Get-Command iscc -ErrorAction SilentlyContinue)?.Source
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $isccCandidates) {
    Write-Fail "Inno Setup 6 not found."
    Write-Host ""
    Write-Host "  Install it with one of:" -ForegroundColor Yellow
    Write-Host "    winget install JRSoftware.InnoSetup" -ForegroundColor White
    Write-Host "    choco install innosetup" -ForegroundColor White
    Write-Host "    https://jrsoftware.org/isdl.php" -ForegroundColor White
    Write-Host ""
    throw "Inno Setup 6 (iscc.exe) not found"
}

Write-Host "        Using: $isccCandidates" -ForegroundColor Gray
& $isccCandidates /Q installer.iss

if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed (exit $LASTEXITCODE)" }

$setupPath = "ClaimsFlow-Scan-Agent-Setup.exe"
if (-not (Test-Path $setupPath)) { throw "Installer .exe not produced" }
$setupMb = [math]::Round((Get-Item $setupPath).Length / 1MB, 1)

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   ✓  Build complete                                      ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Installer : $PSScriptRoot\$setupPath" -ForegroundColor White
Write-Host "  Size      : $setupMb MB" -ForegroundColor White
Write-Host ""
Write-Host "  ── What the installer does ────────────────────────────────" -ForegroundColor DarkCyan
Write-Host "    · Installs agent to  C:\Program Files\ClaimsFlow Scan Agent\" -ForegroundColor Gray
Write-Host "    · Registers Windows service  ClaimsFlowScanAgent (auto-start)" -ForegroundColor Gray
Write-Host "    · Offers optional NAPS2 install (Canon, Kodak, Fujitsu TWAIN)" -ForegroundColor Gray
Write-Host "    · Adds Start Menu shortcuts + optional desktop icon" -ForegroundColor Gray
Write-Host "    · Opens diagnostics page after install" -ForegroundColor Gray
Write-Host ""
Write-Host "  ── Publish to GitHub Releases ─────────────────────────────" -ForegroundColor DarkCyan
Write-Host "    gh release create scan-agent-v1.1.0 ``" -ForegroundColor Gray
Write-Host "      '$setupPath' ``" -ForegroundColor Gray
Write-Host "      'dist\claimsflow-scan-agent.exe' ``" -ForegroundColor Gray
Write-Host "      'install.ps1' ``" -ForegroundColor Gray
Write-Host "      --title 'Scan Agent v1.1.0' ``" -ForegroundColor Gray
Write-Host "      --notes 'Adds Canon eSCL, Kodak ISIS, NAPS2 TWAIN support'" -ForegroundColor Gray
Write-Host ""
Write-Host "  ── Silent one-liner install for IT teams ──────────────────" -ForegroundColor DarkCyan
Write-Host "    irm https://raw.githubusercontent.com/…/install.ps1 | iex" -ForegroundColor Gray
Write-Host ""
