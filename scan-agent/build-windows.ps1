# ============================================================
#  ClaimsFlow Scan Agent — Local Windows Build Script
#
#  Usage (run from the scan-agent/ directory in PowerShell):
#      .\build-windows.ps1
#
#  Produces:
#      .\ClaimsFlow-Scan-Agent-Setup.exe
#
#  Prerequisites (one-time setup):
#      1. Node.js 20+      https://nodejs.org
#      2. NSIS 3+          https://nsis.sourceforge.io/Download
#                          (or: choco install nsis)
# ============================================================

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ClaimsFlow Scan Agent — Windows Installer Build" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── 1. Install Node dependencies ─────────────────────────────
Write-Host "[1/4] Installing npm dependencies…" -ForegroundColor Yellow
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

# ── 2. Bundle agent into standalone exe via pkg ──────────────
Write-Host ""
Write-Host "[2/4] Bundling Node.js + agent into single .exe…" -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path dist | Out-Null
npx @yao-pkg/pkg agent.js `
    --target node20-win-x64 `
    --output dist/claimsflow-scan-agent.exe `
    --compress GZip
if (-not (Test-Path "dist\claimsflow-scan-agent.exe")) {
    throw "pkg build failed — claimsflow-scan-agent.exe not produced"
}
$exeMb = [math]::Round((Get-Item "dist\claimsflow-scan-agent.exe").Length / 1MB, 1)
Write-Host "      Executable: $exeMb MB" -ForegroundColor Green

# ── 3. Download WinSW v3 ─────────────────────────────────────
Write-Host ""
Write-Host "[3/4] Downloading WinSW (service wrapper)…" -ForegroundColor Yellow
if (-not (Test-Path "winsw.exe")) {
    $winswUrl = "https://github.com/winsw/winsw/releases/download/v3.0.0-alpha.11/WinSW-x64.exe"
    Invoke-WebRequest -Uri $winswUrl -OutFile winsw.exe -UseBasicParsing
}
$winswKb = [math]::Round((Get-Item winsw.exe).Length / 1KB, 0)
Write-Host "      WinSW: $winswKb KB" -ForegroundColor Green

# ── 4. Compile NSIS installer ────────────────────────────────
Write-Host ""
Write-Host "[4/4] Compiling NSIS installer…" -ForegroundColor Yellow

# Locate makensis.exe
$nsisCandidates = @(
    "C:\Program Files (x86)\NSIS\makensis.exe",
    "C:\Program Files\NSIS\makensis.exe"
)
$nsis = $nsisCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $nsis) {
    throw "makensis.exe not found. Install NSIS from https://nsis.sourceforge.io/Download (or run: choco install nsis)"
}

& $nsis /V2 installer.nsi
if ($LASTEXITCODE -ne 0) { throw "makensis failed (exit $LASTEXITCODE)" }

$setupMb = [math]::Round((Get-Item "ClaimsFlow-Scan-Agent-Setup.exe").Length / 1MB, 1)

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✓ Build complete" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  Output  : $PSScriptRoot\ClaimsFlow-Scan-Agent-Setup.exe" -ForegroundColor White
Write-Host "  Size    : $setupMb MB" -ForegroundColor White
Write-Host ""
Write-Host "  To publish to GitHub Releases:" -ForegroundColor White
Write-Host "    gh release upload scan-agent-latest ``" -ForegroundColor Gray
Write-Host "      ClaimsFlow-Scan-Agent-Setup.exe ``" -ForegroundColor Gray
Write-Host "      dist\claimsflow-scan-agent.exe ``" -ForegroundColor Gray
Write-Host "      install.ps1 --clobber" -ForegroundColor Gray
Write-Host ""
Write-Host "  (The raw .exe and install.ps1 are needed for the irm | iex one-liner.)" -ForegroundColor DarkGray
Write-Host ""
